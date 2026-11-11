# 运行时动画定位、修复与验证

## 定位实际播放链

1. 读取当前 Unity 实例、Application.dataPath、Play Mode、Selection 和 Prefab Stage。运行时角色可能来自资源加载或对象池，PrefabUtility 返回空路径时，结合角色名、建筑层级、网格和动画资产定位源文件。
2. 从异常网格向上遍历至业务根，记录 localScale、lossyScale、父子路径。区分角色整体展示比例与 rig 的百倍缩放，查找第一个异常节点。
3. 分别读取原始模型、普通角色 prefab、建筑内实例覆盖及运行时 Animator。记录启用状态、Avatar、runtimeAnimatorController、AnimatorOverrideController 的替换片段、当前状态、normalizedTime、实际 clip 的资产路径/GUID及 humanMotion。角色默认控制器可能已被建筑业务替换。
4. 动画未播放时检查 controller 是否为空、默认状态是否有有效 Motion、组件及父节点是否激活、播放速度与状态时间是否推进。双人共用控制器还需核对相对绑定路径和父 Animator 所在节点，避免多个 Animator 同时驱动同一骨架。跟随秋千等运动节点的重挂载需要重新核对路径。
5. 对实际片段读取 Transform 的 scale、position 及旋转绑定，记录键值范围、切线、节点是否存在。模型和 prefab 的 rig 为 1，而动画把它写成 100，说明该片段仍使用旧单位。先列出共享该片段的控制器和角色，确认它们适用同一单位转换。

## 按坐标空间修复

- 在 Assets 外保存原始动画和 .meta，记录哈希、绑定数、时长及采样基线。先用内存中的片段副本验证改动。
- 对已确认从百倍骨架迁移到单位骨架的 Generic 动画，可将指定 rig 的三轴 scale 曲线乘 0.01，将其后代骨骼的局部 position 曲线及有限切线乘 100。rig 自身位移在父坐标系中，需单独计算。按 Transform 类型、完整 path、propertyName 限定处理范围，保留时间、权重和切线模式。
- 帽子、书本、球拍等附件需检查独立的 position/scale 曲线以及 prefab 挂点变换，依据其父空间处理。只变换骨骼路径时避免把附件当作骨骼再次缩放。Humanoid muscle 曲线按重定向配置单独验证。
- 同步所有受影响的序列化表示。文本 .anim 的位置与缩放运行曲线分别在 m_PositionCurves、m_ScaleCurves，编辑器标量曲线在 m_EditorCurves，二者必须一致。

## 保存时验证旋转曲线

Unity AnimationUtility.SetEditorCurve 保存位置或缩放后，曾重算同一片段的旋转切线。每次保存后对比磁盘文件，检查 m_RotationCurves、旋转编辑器曲线、关键帧时间、事件、循环设置、采样率及 .meta。

发现无关旋转差异时，从备份重新生成限定修改范围的候选文件。对已确认结构的 Unity 文本 .anim，可逐条匹配目标 path/property，只替换目标 value、inSlope、outSlope，并保持其他区块原文。验证所有预期绑定都唯一命中、修改数量正确、候选仍可加载后，再原位覆盖并 ImportAsset(ForceUpdate)。使用数值解析处理科学计数法与无穷切线，避免全局替换 100/0.01。二进制、压缩或未知结构先通过 Unity 支持的序列化流程处理。

## 使用业务 Animator 验收

- 在 NewPreviewScene 中复制角色，使用实际建筑的 Avatar、控制器和 override 映射。Generic 专用动作可能使用 null Avatar，应以源配置为准。
- AnimationClip.SampleAnimation 无报错但所有帧姿态相同时，视为尚未驱动成功。检查 Avatar 类型和绑定根，使用实际 Animator 的 Play 与 Update 显式求值，确认状态时间、骨骼或顶点确实变化。
- 修复百倍缩放后，至少覆盖整段循环的 21 个均匀时间点，测量 rig scale、BakeMesh 世界尺寸、手骨及附件轨迹、Layer 和首尾误差。原循环最后一个关键帧与下一轮首帧也分别比较，防止 normalizedTime=1 回绕掩盖接缝。曲线可能在键间超调时再检查极值。
- Layer 通过 LayerMask.NameToLayer("3D") 解析，返回 -1 时先处理项目层配置。所有实际渲染子节点都需验证。
- 刷新仍存活的运行时 Animator 前记录状态及进度，Rebind 后恢复播放并再次观察。用户切换场景或 Selection 后重新定位对象，避免沿用 instanceID。场景角色已卸载时用源建筑配置完成隔离验证，并准确说明验证范围。
- 保存后回读磁盘确认最终文件等于验收候选，核对 GUID 和引用，并查看实际渲染。截图前按修正后尺寸重新取景。finally 清理预览对象、临时片段和 PreviewScene。

## 厨师企鹅案例

2026-11-06，6675 厨师企鹅的默认角色控制器与建筑运行时煮汤控制器不同。实际 ani_buildidleloop_makesoup_02 片段仍写入 rig scale=100。修复了 3 条 scale 和 31 个骨骼的 93 条 position 曲线，保存时校正了接口重算旋转切线的副作用。最终约 4.97 秒循环的 21 个采样点 rig scale 均为 1，手部运动约 0.105 单位。此案例的编号、路径、曲线数量和比例仅作诊断参考，下一批从实际资源重新推导。
