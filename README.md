# Humingbirdbird Art Skills

Reusable Codex skills for game-art production workflows.

## Skills

- [`organize-photoshop-island-layers`](organize-photoshop-island-layers/) - inspect, rename, merge, regroup, rasterize, and verify five-region island PSD/PSB layer structures.

Each skill is self-contained in its own folder so more art-production skills can be added without changing existing ones.

## 安装与使用

在 Claude Code、Codex 等支持 Agent Skills 的工具中，直接告诉 Agent：

```text
帮我安装这个 skill：https://github.com/johnYancg94/Humingbirdbird-Art-skills/tree/main/<skill-name>
```

将 `<skill-name>` 替换为需要安装的 Skill 文件夹名称。Agent 会将其安装到对应的 Skills 目录，无需手动处理路径。

例如，安装 Photoshop 海岛图层整理 Skill：

```text
帮我安装这个 skill：https://github.com/johnYancg94/Humingbirdbird-Art-skills/tree/main/organize-photoshop-island-layers
```
该 Skill 自带必需的 `Photoshop Codex Bridge v1.0.7` Windows 独立安装包和依赖清单。安装 Agent 在复制 Skill 后必须自动运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<已安装Skill目录>\scripts\install_photoshop_bridge.ps1"
```

安装脚本会校验 SHA-256，幂等安装 CEP 扩展、独立 Node 运行时和 Codex MCP 配置，并验证安装版本。它不依赖 UXP Developer Tools、Adobe UPIA 或管理员权限，也不会在安装过程中强制启动或关闭 Photoshop。首次安装后需要重启 Photoshop 和 Agent；后续重复安装会自动检测并跳过已满足的依赖。

如果使用的 Agent 不支持 Skills，可以下载整个 Skill 目录，先运行其中的 `scripts/install_photoshop_bridge.ps1`，再将 `SKILL.md` 作为项目规则文件或直接粘贴到对话中。仅下载 `SKILL.md` 不会安装 Photoshop Bridge 依赖。
