# CI 与测试站点自动部署

## 触发与默认行为

| 事件 | 类型检查、测试、构建 | 保存构建产物 | 部署测试站点 |
|---|---|---|---|
| 推送 `develop` | 是 | 成功后保存 7 天 | 启用开关后，检查成功才部署 |
| 推送 `main` 或其他分支 | 是 | 否 | 否 |
| Pull Request（包含 fork PR） | 是 | 否 | 否 |
| 检查、测试或构建失败 | 失败 | 否 | 否 |

CI 保留 `check` job，使用 Node 22、pnpm 11 和锁文件安装依赖。新增发布脚本语法检查及部署回归测试。部署 job 只下载本次运行保存的 `dist/` 压缩包，服务器不安装 Node、不拉取源码、不重新构建。

首次配置前部署默认禁用。先在 GitHub 创建 `staging` Environment，并限制其部署分支为 `develop`。部署串行执行且不会主动取消正在发布的任务；GitHub 不保证等待任务严格 FIFO，脚本会在连接服务器前、上传后分别核对远程 `develop` HEAD，跳过已过时的构建。

配置开关是 Environment 变量，在部署步骤内读取，不用于 job 级 `if`。未启用时不会读取 SSH 凭据或连接服务器，但仍保存通过检查的 develop 构建产物。若设置了 Environment 审批，禁用状态的 job 也可能等待审批。

## GitHub Environment 配置

仓库 Settings → Environments → `staging`：

| 类型 | 名称 | 说明 |
|---|---|---|
| Variable | `STAGING_DEPLOY_ENABLED` | 完成服务器配置后设为小写 `true`；未设置或其他值均禁用 |
| Variable | `STAGING_HOST` | SSH 公网 IPv4 或 DNS 主机名，不带协议和端口 |
| Variable | `STAGING_PORT` | SSH 端口，留空默认 `22` |
| Variable | `STAGING_USER` | 专用低权限部署用户，例如 `scrubshot-deploy`，不要使用 root |
| Variable | `STAGING_ROOT` | 独立测试站点根目录，例如 `/srv/scrubshot-staging`，不得指向正式站点 |
| Variable | `STAGING_URL` | 测试站点完整访问地址，例如 `https://staging.example.com` |
| Secret | `STAGING_SSH_KEY` | 专用无口令 SSH 私钥全文；公钥放进部署用户的 `authorized_keys` |
| Secret | `STAGING_KNOWN_HOSTS` | 已核验服务器身份的 known_hosts 内容；非 22 端口需 `[host]:port` 条目 |

不要把私钥发到聊天、仓库、Actions 日志或普通 Variables。通过可信服务器控制台核对 SSH 主机公钥指纹，再添加 known_hosts；不要直接信任未经核验的 `ssh-keyscan` 输出。脚本强制主机身份验证，不接受临时跳过验证。

路径仅允许多级绝对路径中的英文字母、数字、下划线和连字符，不支持空格、点、符号链接祖先或结尾斜杠。URL 支持 HTTP/HTTPS、可选端口与由上述字符组成的子路径，不允许凭据、查询参数或片段。子路径部署必须同时正确设置前端 Vite base；当前项目默认部署在域名或端口的根路径。服务器信息尚未提供，当前没有任何真实部署配置或远程操作。

## 服务器准备（Linux + nginx）

管理员在专用测试服务器或独立站点目录配置：

- 安装 Bash、OpenSSH、GNU tar/gzip、GNU coreutils、`flock`（util-linux）和 curl；服务器须能通过 `STAGING_URL` 访问自己的测试站点。
- 允许 GitHub 托管 runner SSH 连接。若安全组不允许或服务器只有私网地址，需另行配置 runner 网络或自托管 runner，不能仅填写私网 IP。
- 创建部署用户及专用密钥；部署用户只能写测试根目录，无需 sudo、无需重启 nginx，避免给正式站点目录写权限。
- 预先创建测试根目录，所有祖先目录可供 nginx 遍历。站点目录权限示例：`0755`，所有者为部署用户，nginx 能读取资源。
- nginx `root` 指向 `/srv/scrubshot-staging/current`，不要把 `current` 预建为普通目录。首次成功发布前此站点可能返回 404。

nginx server 块示例（域名、端口及 TLS 配置需按服务器实际情况调整）：

```nginx
server {
    listen 8081;
    server_name staging.example.com;
    root /srv/scrubshot-staging/current;
    index index.html;
    include /etc/nginx/mime.types;
    open_file_cache off;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }

    location ~* \.(?:onnx|wasm|txt|js|css)$ {
        try_files $uri =404;
        add_header Cache-Control "no-cache" always;
    }
}
```

确认 MIME 表包含 `application/wasm wasm`；有缺失时在 nginx 的 MIME 配置中补充。测试站点建议 HTTPS。若使用 CDN/代理，不得缓存旧首页或资源：健康检查会比对下载内容和本次产物，错误的 SPA 回退、旧缓存、缺失模型或 WASM 都将导致回退。测试部署不生成 `.gz` 旁路文件；可保留 nginx 动态 gzip，但不要复用正式目录里的旧预压缩文件。

## 发布流程、失败处理与回退

1. 通过检查后上传 CI 构建的压缩包，不从用户本地工作区上传文件。
2. 上传到 `incoming/<SHA>-<run_id>-<attempt>.tar.gz`，激活前再次确认 develop HEAD。
3. 服务端通过文件锁串行发布，拒绝已有版本覆盖、越界路径和归档中的链接；解压到 `releases/<SHA>-<run_id>-<attempt>/`。
4. 检查首页、两个 ONNX 模型、字典和 WASM，写入公开的 `scrubshot-release.txt` 提交标记，再原子切换 `current` 符号链接。
5. 从测试 URL 下载首页、提交标记、JS/CSS、模型、字典和 WASM，逐文件比对内容。失败则恢复旧链接，并令 Actions 失败；首次发布无旧版时移除链接。上传或解压检查失败不会改变当前站点。

SSH 连接、上传、健康检查都有超时或工作流总超时。普通中断会触发回退；服务器断电、进程被强制杀死等情况无法保证自动清理，应按当前提交标记和链接检查版本。保留全部历史版本与失败的解压目录供排查；上传失败可能留下部分压缩包，部署用户需定期审查磁盘空间。清理历史版本时，先确认没有发布在运行，且不删除 `current` 指向的版本和需要保留的回退版本。

手动回退时，暂停自动部署或等待部署完成，在服务器用部署用户核验目标版本存在，再原子切换：

```bash
cd /srv/scrubshot-staging
test -d releases/VERIFIED_RELEASE_ID
ln -s "$PWD/releases/VERIFIED_RELEASE_ID" .current-manual
mv -Tf .current-manual current
```

替换 `VERIFIED_RELEASE_ID`，不要照抄占位符；回退后检查首页和 `scrubshot-release.txt`。正式站点不在本流程管理范围内。

## 禁止直接推送 main

这必须在 GitHub 仓库 Settings 的 Rulesets 或 Branch protection 配置，CI 只能在推送已发生后执行，不能拒绝该推送。本次提交不自动修改远程仓库设置；在管理员实际启用规则前，main 仍可能被直推。

为 `main` 配置 Active 规则：

- Require a pull request before merging；按团队规模选择审批数量。
- Require status checks to pass，选择本工作流的 `check`，并要求分支在合并前保持最新。
- 禁止 force push、禁止删除；不要把普通成员、管理员或自动化账户加入可直推的绕过列表。分支保护界面如提供 “Do not allow bypassing”，启用该选项。
- 不要配置会连 PR 合并一起禁止的全面禁止更新规则，也不要把 `deploy-staging` 设为 main 的必需检查，它在 PR 上不会运行。

本地已有的是 `dev` 分支，但自动部署按约定使用 `develop`，本次不会自动新建或重命名分支。工作流进入目标分支后，后续 push 才能触发对应的新规则。首次启用前，在可丢弃的测试分支/站点验证配置和凭据，再打开部署开关。

## 本地验证

```bash
bash -n .github/scripts/deploy-staging.sh
bash -n .github/scripts/staging-release.sh
node --test .github/scripts/test-staging-release.mjs
pnpm test
pnpm build
```

部署测试使用临时目录及替代的 SSH/SCP/curl，不连接真实服务器。覆盖事件拦截、配置缺失、过期提交跳过、上传失败、归档检查、版本切换、资源校验失败回退及首次发布。Linux 测试使用真实 `flock`；Windows 本地测试需 Git Bash 和符号链接权限，`flock` 使用测试替身，CI 会在 Ubuntu 再验证。
