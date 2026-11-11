# 角色导入与游客装配

## 资产与导出
- 身体模型：Assets/GameData/Characters/Model/Body/mesh_characters_<体型>_<编号>.fbx
- 头饰模型：Assets/GameData/Characters/Model/Head/mesh_head_<体型>_head<编号>.fbx（可复用已有 OBJ）
- 材质：Characters/Materials/Body 或 Head，mat_ 前缀；贴图：Characters/Textures/Body 或 Head，tex_ 前缀。
- 正式文件名不能带 Blender 自动生成的 .001/.002 或重复 .png.png；修正导出目标命名，勿为此修改原始资源。皮肤段如 _a1、_a2 按正式命名保持一致。
- 导出前执行 [导出缩放与验收](export-scale.md)，记录源场景单位、实际尺寸及导出器缩放选项。先导出一个代表模型并在 Unity 验收，通过后再批量处理。
- 新角色使用 **Auto-Rig Pro** 导出身体+骨骼。以下是基础选项，单位转换仍须按缩放流程验证。典型已验证选项：arp_export_rig_type=HUMANOID、arp_engine_type=UNITY、arp_ge_sel_only=True、arp_bake_anim=False、arp_export_rig_name=root。arp_apply_mods 根据网格需要开启，尤其 Mirror；导出后恢复原值。
- 选择目标身体和绑定 rig，rig 为活动对象，逐模型导出；不要包含其他角色、摄像机、灯光。实际 operator 和字段应从当前安装的 ARP 读取。
- 换皮只创建新贴图/材质，复用兼容身体。比较拓扑、UV（同拓扑可比较UV哈希）、形状及视觉效果；不能仅凭名称相似判定。
- 头饰如通过 ARP 得到蒙皮 FBX，先在临时 Blender 场景导入该导出物，在正确静止姿态取 evaluated mesh 并烘焙世界变换，再导出单静态 FBX。保留其相对角色坐标以供游客工具定位，避免再次乘骨骼变换。
- Unity 身体：globalScale=1、useFileScale=True；Humanoid、Create From This Model、importAnimation=False、materialImportMode=None、preserveHierarchy=True。先检查导入模型自身的层级和缩放，再进入游客工具装配。验证 avatar.isValid && avatar.isHuman、无 AnimationClip 子资产及完整左右肢骨映射。需要时从已确认同骨架模型复制显式 HumanDescription，不能随意套不兼容映射。
- 新材质复制同类参考属性并替换贴图，已验证 shader 为 Custom/TextureFade。

## 通过游客工具创建
读取当前实现：
- Assets/Scripts/IslandSplash/Component/ISVisitorManager.cs
- Assets/Scripts/IslandSplash/Editor/Tools/ItemConfigToolEditor/AboutVisitorManager/Windows/CreateVisitorConfirmEditorWindow.cs
- 同目录上级 DealWithAboutVisitorManagerEditor.cs
- Assets/Scripts/IslandSplash/Struct/EditorShared/VisitorEditorDataStructCfg.cs
- Assets/Scripts/IslandSplash/Struct/FileLoad/ISAssetObject.cs

已验证 API 顺序：
1. 构造 ISAssetObject(身体路径)，用 ISVisitorManager.ChangeBodyModel，ChangeBodyMat，SetAnimatorController 装配。
2. 头饰构造 CharacterObjectItem、CharacterMatItem、CharacterInstanceObjectItem，调用 AddDecorationItem2Body(CharacterBodyPartType.头, item)。该方法 SetParent(..., true) 保留世界位置；不要随后盲目归零头饰坐标。
3. CreateVisitorNeedData 填 CurBodyObjItem、CurScenePrefabInstanceGo、NodeMap=GetCurBodyMap()、RootAnimator=GetRootAnimator()、ExistPrefabList、Type。
4. 使用 CreateVisitorConfirmEditorWindow.Open() 正常窗口入口及其创建方法。它负责 EntityView、AnimatorInfoRecorder、AnimatorLOD、Tag、Layer、Scale 等，不手工生成一个缺少工具组件的“相似预制体”。
5. 用户只要建筑游客时，在 RefreshData 之后将 createCommonVisitor/createStoryVisitor 设 false（RefreshData 会恢复默认 true）。
6. 保存到 Assets/GameData/Package/Island/<实际海岛目录>/<实际XAssets目录>/Prefab/Characters/BuildVisitor/prefab_buildCharacter_<体型>_<新编号>.prefab。先扫描全工程对应类型编号并取最大值+1，再检查路径和游客表，避免跨海岛/体型冲突。不要硬编码历史下一编号。通用、故事、建筑序列分开。
7. 创建成功后回读预制体，不能因后续 Close/回调错误就重新创建。记录已完成项，重试只处理缺失项。

若使用隔离临时装配：建立 manager、makePrefabNode、Root/visitorRootNode，使用上述正式方法；finally 清理。当前工具支持反射调用 private CreateNewPrefab(string, CharacterPrefabType)，须指定参数类型避免重载歧义；优先公共入口，私有入口版本变化须重读源码。

## 待机与 OtherView
以下为已验证的通用建筑游客待机配置，按本批需求选择游客类型及动作。建筑专用动作需核对建筑 prefab 覆盖和运行时控制器，按 [运行时动画修复](animation-repair.md) 验证。
- OtherView 挂预制体根；Animator 挂直接子节点 Root（脚本 Awake 查找此路径）。
- mCrossFadeTime=0.3；IdleLoop=ani_buildidleloop_01。
- Idles=[ani_buildidle_01,02,03,04,05]，每项写完整状态名。
- IdlesAnimPlayCountLimit=[1,2,1,2,1]，与 Idles 一一对应。1 表示下一次随机选择不能重复该动作；2 表示最多连续选中两次；0 是不限。循环待机插入其间不重置随机动作的连续计数。
- IdleSwtichTime=[6,8,10]；当前 OtherView 实际只使用前两项随机 6–8 秒，第三项不生效。不要宣称随机选 6/8/10 秒。
- 已用控制器 animctrl_buildvisitor_man_standidlePack01.controller 位于 Characters/Controller/BuildVisitor。不要只按性别名称猜兼容性；有合适体型控制器优先用它。复用此通用 Humanoid 控制器到女性时明确说明并采样验证。
- 不把待机流程说成已配置各建筑工作动作。

## 配表与验收
### 写表缓存与持久化检查
- 执行前确认当前 Unity 工程，并解析 `PathConst.VistorConfigExcelFilePath` 的绝对路径。记录实际目标工作簿，不能只报告“游客表”。
- 检查工作簿是否被 Excel/WPS 锁定；若已打开且不可独占读取，先完成只读核查，等待用户保存并关闭后再写入，不强制关闭、不绕过文件锁。
- 检查 `OnVisitorPrefabCreated` 现有订阅及目标工具实例的 `_vistorExcelDataList`。优先复用已有正式工具实例；写入前从当前磁盘重新加载数据，不直接使用先前加载的旧表缓存。
- 禁止通过清空全局创建事件、使用临时 helper 写表、最后恢复旧事件订阅且不刷新缓存的方式完成配表。旧实例随后会用过时数据整表写回，覆盖新记录或名称修改。
- 确需临时 helper 时，记录并精确清理它在创建、删除、LoadOver 等事件上的所有订阅；不能只恢复其中一个事件。完成后同步所有存活写表实例的缓存，保留用户界面的正常订阅。存在未保存的工具编辑时先核对差异，不盲目替换。
- 缺失记录使用正式 `OnOnVisitorPrefabCreated` 写表流程补齐，仅处理缺失编号，不重新创建 prefab。已存在编号的名称改动应通过现有记录更新和正式写表方法完成；创建回调遇到已有编号会直接返回，不能用于改名。
- 写入前备份当前工作簿。写入后独立从磁盘解码实际工作表单元格，确认本批每个 Id 恰有一条，ModelAssetName 与实际 prefab 名称完全相同，并核对 Type、BodyType、ActionId。仅搜索 sharedStrings 或信任工具日志不算验收。
- 对照写入前快照，验证其他游客记录及其他工作表数据未变化；同时回读所有存活工具实例的缓存，确认本批数据与磁盘一致。只有这些检查完成后，才能报告配表完成。

创建回调通常写 Assets/GameData/Scheme/Excel/Y_游客表.xlsx。窗口打开不等于事件订阅已初始化：
- 从磁盘回读新编号是否各有一条。若未写，读取正式 OnOnVisitorPrefabCreated 回调和初始化，使用工具的写表流程补齐；不要随意整本Excel另存。
- 历史建筑记录 Type=6、ActionId=1008，BodyType 由工具依据体型确定。保留工作簿其他工作表及既有数据。
- 验证源 PNG 尺寸、平台设置、无重名/重复记录；骨骼引用、材质贴图、EntityView、OtherView 数组及控制器状态。
- 对循环与5个idle采样多个时间，检查 BakeMesh 范围和实际顶点运动，检查头饰随头运动、不漂浮。渲染整批预览并查看图片。
- 更新工具资源缓存时使用现有刷新入口；不要改源码或重启场景只为刷新列表。
- 表格代码生成、建筑绑定和正式游戏测试是独立步骤，未经执行不得声称完成。
