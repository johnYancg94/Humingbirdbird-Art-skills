# 接口与故障处理

## Blender MCP
优先发现已连接的 Blender 工具。若当前工具目录未暴露 Blender，可检查已安装并运行的本地 MCP 服务，读取其协议后调用；不要安装插件或猜端口。
本机曾出现两种协议：
- 旧 blender_mcp：JSON {"type":"execute_code","params":{"code":"..."}}。
- Blender 5.2 lab_blender_org/mcp：JSON {"type":"execute","code":"...","strict_json":false} 加 null 字节结束，响应亦以 null 分隔。历史监听127.0.0.1:9876，须重新检查。
用错协议会超时；一次超时后检查正在使用的插件实现，勿反复盲重试。
新版服务保留 result 变量作为返回值且要求 dict；不要把 bpy.ops 返回的 set 存进 result。出现这个包装错误时，导出本身可能已成功，先验文件再决定重试。
输出使用 UTF-8，避免中文文件名经终端编码损坏；从 Blender 内写 JSON 清单再读取可以保留准确路径。

ARP 导出得到 rig 或蒙皮节点 Scale=100 时，先执行 [导出缩放与验收](export-scale.md)。读取当前 ARP 的单位转换实现及最终 FBX 参数，验证一个代表导出物后再继续批量装配。

ARP 已验证 operator 为 bpy.ops.arp.arp_export_fbx_panel('EXEC_DEFAULT', filepath=...)，但版本变化需检查 RNA/源码。它内部创建副本，成功后会恢复场景；外层仍需 finally 恢复自行更改的选项、选择和可见性。

## Unity MCP
- 先读取 editor/state、Selection 和实际工程路径，等待编译或切换状态稳定。运行时问题先在 Play Mode 采集层级、控制器及动画证据；编辑 prefab 时进入 Edit Mode，动画资产修复与隔离验证按 [运行时动画修复](animation-repair.md) 执行。
- execute_code 必须 action="execute"；代码是 C# 方法体，不能写 using 指令，使用全限定名称。
- 读当前项目源码验证工具 API。反射同名重载时用 GetMethod(name, flags, null, parameterTypes, null)，仅按名字会 AmbiguousMatchException。
- ModelImporter/TextureImporter 修改后 SaveAndReimport。
- 预制体编辑采用 LoadPrefabContents → 修改 → SaveAsPrefabAsset → finally UnloadPrefabContents。
- 临时渲染使用 NewPreviewScene，camera.scene 显式指向预览场景，finally 恢复 RenderTexture.active、销毁临时相机/纹理并 ClosePreviewScene。
- 不在 OnValidate 中同步 SaveAssets；不为资产导入修改项目业务代码。
- 游客窗口通过 Open() 获取可关闭实例。创建后的 Close/刷新或写表回调可能失败，应先回读已有预制体，不能重跑整批产生重复编号。
- 创建窗口 RefreshData 的旧编号判断存在最大编号恰等于起始值时不递增的边界，外部扫描全局当前最大值并检查目标路径。
- Unity asset refresh/domain reload 后引用可能失效；重读资源，尤其 Prefab Stage、Selection 和运行时 instanceID。

## 已有交付证据（历史，不是当前状态）
在 F:/unityproject/IslandSplash4/Artifacts 下：
- EgyptVisitorImport_20260928：男性7个，6666–6672；工程师明确复用 Unity head06 与 tex_head_man_head06_b；新 head40 冲突使用 egypt 后缀。
- EgyptWomanImport_20260928：女性5个，6673–6677；两新增身体、三换皮。
- HippieItemImport_20260928：八道具，六手持偏移；manifest、preview、hand-preview、hand-offsets。
临时 Temp 目录会被 Unity 清理，不能依赖它作为唯一高分辨率源或流程脚本备份。新任务重新核对编号、路径及原文件。
