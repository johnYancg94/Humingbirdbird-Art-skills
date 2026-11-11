# 角色 FBX 导出缩放与验收

## 适用范围与故障特征

角色身体、绑定骨骼、角色动画导出及已有资源重导入都执行本流程。保留原始 Blender 内存场景，在临时副本或临时场景操作，finally 恢复导出设置及上下文。

本批企鹅曾出现 Blender 对象 Scale=1，而 Unity 的 rig 与 SkinnedMeshRenderer 节点 localScale=100、网格数据约缩小为 0.01 的情况。视觉尺寸可因补偿保持正常，手持道具、挂点和动画却会受影响。Blender Apply Scale、Unity Inspector 的 Import Scale Factor=1、静态截图均不足以单独证明单位转换正确。

## 导出前记录

- 读取 scene.unit_settings.system、scale_length，mesh/armature 的 matrix_world、local scale、父级变换、rest bones 和当前 action。记录相同参考姿态下的世界顶点范围、角色高度及代表性骨骼位置。对照同体型正常资源，区分场景排列缩放与正式角色比例。
- 明确源单位与 Unity 米制尺寸的对应关系。发现 scene scale_length=0.01 时先核实实际尺寸及导出器的单位处理，避免再手动乘 100。源对象 Scale=1 仍需验证 FBX 输出。
- 读取当前安装的 ARP operator、RNA 或源码，定位导出时的单位转换、Apply Scalings、最终 global_scale、apply_unit_scale、apply_scale_options。ARP 各版本字段不同，基础 UNITY/HUMANOID 选项不保证相同缩放结果。

## 导出与代表样本

1. 先用 ARP 的复制导出流程导出一个正式身体及其 rig 到 Assets 外，保留正式骨骼名称、层级、rest pose、蒙皮与所需动画。把最终导出选项写入本批报告，验证通过才批量导出。
2. 使用 Blender 原生 FBX 导出器时，米制一致场景的优先验证组合为 global_scale=1.0、apply_unit_scale=True、apply_scale_options='FBX_SCALE_ALL'、axis_forward='-Z'、axis_up='Y'。FBX_SCALE_ALL 将缩放交由 FBX 全局单位表达；最终仍以 Unity 实际导入结果为准。不要把 FBX_SCALE_NONE 当作角色固定默认值。
3. 骨骼导出优先 bake_space_transform=False、add_leaf_bones=False。静态 MESH 的 bake_space_transform=True 流程有独立用途，骨骼、蒙皮和动画必须一起验证，避免直接套用静态流程。选择 MESH 与 ARMATURE，并按交付要求控制 bake_anim。已有动画需保留约束求值及烘焙结果。
4. 若 ARP 最终输出仍有百倍补偿，在隔离场景导入该 FBX，对生成的 deform rig 和网格以已验证的单位组合归一化再导出。此次企鹅修复的有效路径是导入原 FBX 后用 FBX_SCALE_ALL 重导。每次都对比尺寸、骨骼、蒙皮和动画；只处理导出副本。避免逐个盲目 Apply Transform，绑定关系和动画曲线可能因此失配。
5. 第一份导出物在 Unity 临时验证位置导入。验证后移除本次临时资产，正式文件按原路径落盘并保留 .meta/GUID。重复同批已验证的导出组合；遇到不同源单位或不同 rig 时重新做代表样本。

## Unity 装配前验收

Importer 使用 globalScale=1、useFileScale=True，修改后 SaveAndReimport。记录 fileScale 供诊断，FBX 单位元数据可以不是 1。不能通过更改 Import Scale Factor、prefab 根或道具缩放来掩盖子节点的百倍补偿。

- 实例化原始模型资产，先于游客工具和 prefab 补偿检查。模型根、rig、蒙皮节点 localScale 各轴应约为 1，容差 1e-4；骨骼 rest scale 对照同骨架规范。遍历整条祖先链并记录 localScale、lossyScale，排查 100/0.01 配对、异常负缩放和非均匀缩放。已有明确用途的整体展示比例单独记录。
- 对比源参考姿态与 Unity 的世界尺寸。分别记录 mesh.bounds、Renderer.bounds、BakeMesh 的世界顶点范围和关键骨骼间距，避免祖先补偿掩盖网格或骨骼数据的单位错误。预先确定尺寸容差并报告最大误差。
- 验证骨骼名称/层级、bones 与 bindposes 一一匹配、权重有效、材质和 UV 保持、无丢失引用。Humanoid 验证 avatar.isValid && avatar.isHuman；已有 Generic 专用动画沿用兼容的 rig 配置。
- 正常业务 Animator 播放实际待机、专用动作和道具交互动作，至少采样首帧、四分之一、中点、四分之三与末帧。检查非零顶点/骨骼运动、包围盒、首尾衔接及异常跳变。对有 scale 曲线的片段同时检查帧间极值，排除播放后写回 100/0.01。
- 挂接一个单位缩放的测试道具，验证手骨世界轨迹、道具可见尺寸和跟手运动。已有书本/球拍还需检查专用动画对挂点的 position/scale 覆盖。角色和道具的全部渲染子节点 Layer 应为当前项目的 3D 层。
- 第一份通过后批量处理，每个模型重复层级与尺寸检查，角色 prefab 和 Combined prefab 分别验收。记录资产路径、导出参数、异常数量、尺寸误差与动画采样结果，未执行的实机业务验证明确列出。

模型静态缩放正常、播放后出现异常时，继续执行 [运行时动画修复](animation-repair.md)，追踪实际业务控制器并验证磁盘曲线差异。

## 已有资源的原位迁移

- 导出到 Assets 外并保留恢复副本，验证通过后覆盖原 FBX 内容，保持 .meta/GUID。核对 Unity 子资产 fileID、Avatar 和 prefab 引用是否仍有效。
- 先列出依赖的普通角色、Combined 角色、建筑 prefab、控制器、动画及手持挂点。检查嵌套 prefab 的缩放覆盖，修改后保存并回读磁盘验证。
- 若旧 Generic 动画记录了原 rig scale=100、骨骼 position 或道具 scale=0.01，按已测出的坐标空间关系迁移对应曲线及切线。先确认 binding 路径和所属角色，避免整段动画统一乘除 100。Humanoid 和 Generic 分别采样验收。
- 已有 Combined 网格通过项目正式合并流程更新原资产，保留原路径/GUID、UV、材质和图集引用，并核对骨骼槽位顺序、bindposes 与全部蒙皮权重。对比普通与 Combined 的实际动画和外观后才可完成交付。
