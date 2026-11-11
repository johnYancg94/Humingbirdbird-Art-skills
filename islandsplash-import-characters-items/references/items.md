# 配方道具导入与手持偏移

## 参考规范与导入
本次参考：
Assets/GameData/Package/Island/IslandHollywood/IslandHollywoodXAssets/Prefab/Characters/Item
读取实际预制体及其引用，不将参考道具的手持偏移复制给新道具。

- 模型：Assets/GameData/Characters/Model/Item/mesh_item_<海岛>_<hand/prop/cap>_<编号>.fbx
- 材质：Characters/Materials/Item/mat_item_<同后缀>.mat
- 贴图：Characters/Textures/Item/tex_item_<同后缀>.png
- 预制体：Package/Island/<海岛>/<XAssets>/Prefab/Characters/Item/prefab_item_<同后缀>.prefab
- 结构：prefab → Root → 嵌套模型，参考 Layer=6。单静态网格、单材质；无无关相机、骨骼或动画。Custom/TextureFade，PNG 源尺寸64×64。
- 名称、数量以当前正式资源为准。历史 HippieIsland 为 hand_01–06、prop_07–08，共8个；这不是通用固定数量。
- 导出排除参考角色和展示相机。复制对象+网格，清父级并清场景排列位移，保留道具原点与实际旋转/缩放。
- 一种稳健方法：读取 src.evaluated_get(depsgraph)，new_from_object 获取副本网格；将 src.matrix_world 去掉 translation 后烘焙到该网格；新对象单位变换。避免又 transform_apply 一次导致重复变换。
- 静态道具 FBX 使用 use_selection=True、object_types={'MESH'}、axis_forward='-Z'、axis_up='Y'、bake_space_transform=True、bake_anim=False，不嵌入贴图。该静态流程仅用于无骨骼道具，角色骨骼导出另按 [导出缩放与验收](export-scale.md) 执行。
- 不将多材质直接合并为单色；如发现多个外观材质，先解决外观保持方式。
- 导出后用实际世界顶点或 transformed bounds 检查尺寸，Blender object.dimensions 可能与当前顶点世界范围不一致；不能仅凭缓存尺寸断言导出错误。Unity 中要考虑节点变换，不只看 mesh.bounds。

## 挂载到当前角色
仅在用户要求挂载时执行；单纯导入不应改共享角色预制体。

1. 读取 Unity 当前 Selection、Prefab Stage 和角色路径，确认 hand.l 位于哪个角色。历史示例是 prefab_character_man_1095；不要硬编码为未来目标。
2. 识别 hand 道具；prop/cap 不自动挂左手。逐个作为嵌套预制体挂在 hand.l 下，实例根 localPosition=0、localRotation=identity、localScale=1，偏移保存到道具预制体 Root。
3. 以当前骨骼姿态和角色缩放为参考，逐个调整位置及朝向：盘/唱片/书本采用合理托持，杯子对齐握持区域。从多个角度看手指、杯口、掌面穿插及悬浮，不能只把 bounds.center 对准手骨即宣称完成。
4. 计算世界目标方向时转回 hand 的局部坐标；保留真实道具比例。不要把前一角色下的数值当通用偏移。
5. 临时预览一次显示一个道具；最终保留哪些实例及默认显示项按照任务选择并报告，避免6个同时叠在手上。
6. 保存道具资产可能触发 Prefab Stage 重载，之前保存的 Selection/Transform 引用会失效，挂载实例可能暂时成为场景根。**每次资产保存后重新定位当前 stage 和 hand.l**，确认所有目标实例实际仍在骨骼下；完成所有道具资产修改后再统一恢复挂载并保存角色。
7. 回读磁盘角色预制体，验证实例数量、父节点、Root偏移、引用、激活状态，截图确认最终姿态。用户只要求预览时不要将挂载写入共享角色资产。
8. 当前姿态合适不保证所有动画都合适；用户要求动画内握持时还需对相应动画采样检查。角色缩放修复后，检查动画是否仍把道具 localScale 写回 0.01 或 100，验证挂点世界位置、可见尺寸和跟手运动。角色及道具子节点的 Layer 用当前项目 LayerMask.NameToLayer("3D") 解析并逐层验证。
