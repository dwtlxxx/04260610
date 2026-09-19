# GitHub 部署手册（考核现场可直接照做）

> 目标：把本地写完的静态网页发布成 `https://dwtlxxx.github.io/04260610/`，评委点开即用。

---

## 一、前置：SSH 免密推送（本机一次性配置）

在**你自己的终端**（不是沙箱）执行，`<工作区>` 替换为本仓库所在路径。

### 1. 配置 Git 身份

```bash
git config --global user.name "dwtlxxx"
git config --global user.email "dwtlxxx@users.noreply.github.com"
```

### 2. 启用工作区内生成的密钥

密钥已在 `<工作区>/_keys/` 下生成：

- `id_ed25519_github` —— 私钥（**绝不外传、绝不提交**）
- `PUBKEY_复制这一行.txt` —— 公钥（要贴到 GitHub）

把私钥放到标准位置，让 SSH 自动找到：

```bash
mkdir -p ~/.ssh
cp "<工作区>/_keys/id_ed25519_github" ~/.ssh/id_ed25519_github
cp "<工作区>/_keys/gh_hostkeys.txt"   ~/.ssh/known_hosts
```

PowerShell 版本：

```powershell
New-Item -ItemType Directory -Path "$env:USERPROFILE\.ssh" -Force
Copy-Item "<工作区>\_keys\id_ed25519_github" "$env:USERPROFILE\.ssh\id_ed25519_github"
Copy-Item "<工作区>\_keys\gh_hostkeys.txt"   "$env:USERPROFILE\.ssh\known_hosts"
```

### 3. 添加公钥到 GitHub

1. 打开 <https://github.com/settings/keys>
2. 点 **New SSH key**
3. Title 填 `interview-2026`，Key 粘贴 `PUBKEY_复制这一行.txt` 里的**一整行**
4. 保存

### 4. 验证

```bash
ssh -T git@github.com
```

看到 `Hi dwtlxxx! You've successfully authenticated...` 即成功。

若 22 端口被网络封锁，改用 443：

```bash
ssh -T -p 443 git@ssh.github.com
```

并在仓库内写入永久配置：

```bash
git config core.sshCommand "ssh -p 443"
```

---

## 二、每次交付的固定动作

```bash
# 1. 查看改了什么
git status
git diff

# 2. 暂存 + 提交（提交信息要能说明这一步做了什么）
git add -A
git commit -m "feat: 完成待办事项的新增与勾选功能"

# 3. 推送
git push -u origin main
```

> **考核要求**：至少 3 次**有实际意义**的 Commit。不要一次 `git add` 全部然后只提交一次——评分看的是**迭代过程**。

推荐的提交节奏：

| 序号 | 提交信息示例 | 说明 |
| --- | --- | --- |
| 1 | `chore: 初始化项目骨架与 README` | 可运行的空白骨架 |
| 2 | `feat: 实现核心功能 X` | 主功能可用 |
| 3 | `feat: 增加 Y 交互与本地持久化` | 增强体验 |
| 4 | `fix: 修复 Z 场景下的异常` | 体现调试与问题解决 |
| 5 | `docs: 完善 README 与使用说明` | 文档收尾 |

---

## 三、开启 GitHub Pages

1. 打开仓库 → **Settings**
2. 左侧菜单 → **Pages**
3. **Build and deployment → Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，**Folder** 选 `/(root)`
5. 点 **Save**
6. 等待 1～2 分钟（页面顶部会出现绿色提示与站点地址）
7. 点 **Visit site** 检查

> 纯 HTML/CSS/JS 项目选 `/(root)` 即可，**不需要任何构建**。这是最不容易翻车的方案。

---

## 四、提交前 5 项自检（照着打勾）

- [ ] 用**浏览器无痕窗口**打开 Pages 链接，确认**无需登录**即可访问
- [ ] 首页正常显示：图片、样式、按钮、页面跳转**没有失效**
- [ ] 题目要求的**核心功能**和自主设计的**加分功能**都能实际操作
- [ ] 仓库已完成**最终 Push**，Pages 显示的是**最新版本**（可强刷 `Ctrl+F5`）
- [ ] 提交的两个链接**没有复制错误**

---

## 五、常见故障速查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| Pages 打开是 404 | 分支/目录选错，或还没部署完 | 重选 `main` + `/(root)`，等 2 分钟；确认仓库根目录有 `index.html` |
| 页面能开但**样式/图片全丢** | 用了绝对路径 `/css/style.css` | 改为相对路径 `./css/style.css` |
| 页面能开但**按钮点了没反应** | 资源 404 或 JS 报错 | 按 `F12` 看 Console 报错，逐个修 |
| 下划线开头的文件夹内容 404 | Jekyll 忽略下划线目录 | 根目录放一个空的 `.nojekyll` 文件（已创建） |
| `ssh: connect to host github.com port 22: Connection timed out` | 22 端口被封 | `git config core.sshCommand "ssh -p 443"` |
| `Permission denied (publickey)` | 公钥没加，或加了但加了多余字符 | 重新粘贴**一整行**公钥；`ssh -T git@github.com` 复验 |
| `Updates were rejected` | 远端有本地没有的提交 | `git pull --rebase origin main` 后重新 `push` |
| 用了 Vite/React 后 Pages 白屏 | 资源路径没配 `base` | `vite.config.js` 里设 `base: '/04260610/'`，并改用 `dev` 分支 + Actions 部署 |

---

## 六、与 Steam++（Watt Toolkit）加速共存

### 问题本质

Steam++ 开启 GitHub 加速时，会做两件事：

1. 改写 `hosts`，把 `github.com`、`api.github.com`、`raw.githubusercontent.com`、`*.github.io` 等指向 `127.0.0.1`
2. 在本机起一个反向代理，用自签证书（`CN=SteamTools Certificate`，`O=BeyondDimension`）与客户端完成 TLS 握手

因此不同工具的反应完全不同：

| 工具 | 是否认这张自签证书 | 结果 |
| --- | --- | --- |
| 浏览器 | 认（证书装在系统根证书区） | **正常访问，加速生效** |
| **Git over SSH** | **不走 TLS，完全无关** | **正常，不受影响** |
| Node / Python 默认 | 不认 | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| Git over HTTPS（schannel 后端） | 不认 | `schannel: AcquireCredentialsHandle failed` |

> **结论：推送本身不受 Steam++ 影响。** 本仓库用 SSH 推送（`core.sshCommand = ssh -F _keys/gh_ssh_config`），SSH 协议不经 TLS，所以加速开着也能正常 push/pull。

### 让 HTTPS 类工具也能在加速下工作（安全做法）

不要用「关闭证书校验」这种粗暴做法，而是**显式信任这张证书**，证书校验依然开启：

```powershell
# 1. 导出 SteamTools 证书为 PEM（已导出到 _keys/steamtools-ca.pem，指纹 4C595716...）
# 2. 让 git 使用 openssl 后端并显式信任它
git config http.sslBackend openssl
git config http.sslCAInfo _keys/steamtools-ca.pem
```

验证（应输出远端引用且无证书报错）：

```powershell
git ls-remote https://github.com/dwtlxxx/04260610.git
```

### 让 Node 类工具（核验脚本）在加速下工作

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
```

`tools/check-remote.ps1` 已内置该设置，因此在 Steam++ 全速加速时**依然能核验远端仓库状态**。它优先使用 `api.github.com`（该域名通常不被 hosts 劫持，比 `raw.githubusercontent.com` 稳定）。

### 如果 hosts 又被改写

Steam++ 每次启动/切换加速项都会重写 hosts 中的 GitHub 段。出现以下症状即为被改写：

- `Resolve-DnsName github.com` 返回 `127.0.0.1`
- 非浏览器工具报证书错误

**处理方式**：这其实是加速在正常工作，不必清除。用上面的两个配置绕过即可。若确实需要临时关闭加速，在 Steam++ 界面关掉网络加速，再执行：

```powershell
ipconfig /flushdns
```

