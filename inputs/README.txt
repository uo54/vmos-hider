可选：把原版（已清除签名校验的）VMOS Pro APK 放到本目录并命名为

    vmos-original.apk

然后提交到仓库。GitHub 网页上传单个文件限 25MB，而该 APK 约 41MB，
所以网页传不上来。推荐方式（教程见根目录 README.md）：

    网页创建 Release（标签写 original）→ 上传 APK 作为附件
    → GitHub Actions 构建时会自动下载 Release 里最新版 APK。

如果你用 git 命令行推送（仓库文件上限 100MB），则把文件放到这里即可，
工作流会优先使用本文件。
