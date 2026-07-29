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

如果使用的 Agent 不支持 Skills，可以打开对应 Skill 目录，下载其中的 `SKILL.md` 全文，将其作为项目规则文件，或直接粘贴到对话中让 Agent 按照规则执行。
