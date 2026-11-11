---
name: islandsplash-import-characters-items
description: 将当前 Blender 中的角色、新增或换皮资源及配方道具导入 IslandSplash4 Unity 工程，通过三消工具箱游客管理流程创建预制体，配置贴图源尺寸、随机待机及角色手持挂点。适用于该项目的 Blender→Unity 资源交付和后续装配调整。
---

# IslandSplash4 角色与配方道具导入

使用当前 Blender 内存场景和当前 Unity 工程，先发现实际文件、对象和已有资源，不把历史海岛、角色或编号当作当前目标。参考环境为 Windows、Unity 2022.3 Built-in/Gamma；工程通常位于 F:/unityproject/IslandSplash4。以当前 AGENTS.md 和用户最新要求为准。

## 路由
- 角色、新增/换皮、游客预制体：读取 [角色流程](references/characters.md)。
- 配方道具、手持挂载、偏移：读取 [道具流程](references/items.md)。
- 任何角色 FBX 导出、重导入或百倍缩放修复，在装配前读取并执行 [导出缩放与验收](references/export-scale.md)。
- 播放后变大、道具异常、动画未播放，读取 [运行时动画修复](references/animation-repair.md)。
- 整理 SVN 提交清单或交付审核窗口，读取 [SVN 交付](references/svn-delivery.md)。
- MCP 连接、ARP 导出或编辑器调用遇到问题：读取 [接口与故障处理](references/integration.md)。

## 共同约定
1. 每次先核实 Unity 实例及 Application.dataPath，将实际工程根目录用于资源查找、备份和版本控制。通过 Blender MCP 读取文件名、合集、正式模型名、骨骼、材质图片、UV、修改器。通过 Unity MCP 读取实例、编辑器状态、选中对象和 Prefab Stage。用户说“当前角色”时先检查两端，不假设指 Blender。
2. 海岛由用户指定或源 .blend 文件名确定；新增/换皮由合集划分，合集中的模型名是正式命名。对照当前工程验证目标路径和重名。
3. 记录本批清单：角色/道具→模型→贴图→材质→控制器→预制体。换皮不重复导出模型，先验证模型/UV兼容性。重名资源内容相同则复用，不同则避免覆盖并明确区别。历史 egypt 后缀仅是曾获确认的冲突处理，不自动用于所有新任务。
4. 保留原始 Blender 对象、网格、原图和未保存编辑；导出用副本或 ARP 自身的复制导出流程，finally 恢复选择、活动对象、可见性、导出选项、当前场景。不为导出保存覆盖 .blend。
5. **Unity Assets 中的 PNG 源文件本身必须达到目标尺寸**，仅设置 Max Size 不算完成。复制原图后缩放，保留外部高分辨率原图。修改现有资源时保留 .meta/GUID。
6. 角色本项目默认身体 128×128、配饰 64×64；配方道具本批规范为 64×64。用户指定尺寸或对应类型有明确新规范时以其为准。导入通常 sRGB 开、Mip Maps/Read Write 关，Android/iPhone ASTC 6×6；读取相同类型参考后应用。
7. 只修改当前授权批次。输出简短交付清单和验证结果；区分资源/预制体已完成、配表已完成、代码生成、建筑业务绑定和正式游戏验证。不能用静态截图宣称运行时流程已验证。
8. 报告和可恢复导出副本放工程 Artifacts/<批次名>/，不把临时脚本放 Assets 触发编译。完成后清理本次临时场景对象；不要删除用户场景或无关资产。
9. 角色导出必须经过 Unity 缩放验收。新导入身体的模型根、rig、蒙皮网格节点应为单位缩放，骨骼 rest localScale 应与同骨架规范一致。检查祖先链及动画采样，排查 100 与 0.01 相互抵消；仅看最终外观大小不能通过验收。
10. 修复已有资源时沿用原路径、原文件名和 .meta/GUID，同步受影响的普通及 Combined prefab、动画和挂点。临时归一化 FBX、Fix 目录和试验动画留在 Assets 外，验收后原位替换正式资源。
