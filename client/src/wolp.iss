; wolp.iss - Inno Setup Script
[Setup]
AppName=WOLP
AppVersion=1.0.0
; 输出安装包的文件名，默认输出到脚本所在目录
OutputBaseFilename=wolp_installer
DefaultDirName={pf}\WOLP
DefaultGroupName=WOLP
; 安装时请求管理员权限
PrivilegesRequired=admin
; 64位模式（若你的程序仅打算安装在64位系统下可以这样写）
ArchitecturesInstallIn64BitMode=x64

[Files]
; 将你的可执行文件和前端文件都打包进来
; 例如 go build 的结果是 wolp.exe
Source: "D:\path\to\wolp.exe"; DestDir: "{app}"; Flags: ignoreversion
; 如果有静态文件，按需打包。比如 webui 整个文件夹：
Source: "D:\path\to\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; 在开始菜单创建快捷方式
Name: "{group}\WOLP"; Filename: "{app}\wolp.exe"
; 在桌面创建快捷方式
Name: "{commondesktop}\WOLP"; Filename: "{app}\wolp.exe"; Tasks: desktopicon

[Tasks]
; 定义一个任务用来创建桌面图标，可选
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"

; 定义一个任务用来是否安装为服务，可让用户勾选（如果你不想让用户选择，则直接做静默创建服务）
Name: "installservice"; Description: "Install WOLP as a service"; GroupDescription: "Service setup:"

[Run]
; 安装完成后自动运行可执行文件（可选）
; Filename: "{app}\wolp.exe"; Description: "启动 WOLP"; Flags: nowait postinstall skipifsilent

; 在安装时通过 sc 命令创建 Windows 服务（仅当用户勾选了 installservice 时执行）
Filename: "sc.exe"; \
    Parameters: "create WOLPService binPath= ""{app}\wolp.exe"" start=auto DisplayName= ""WOLP Service"""; \
    Description: "创建 WOLP Windows 服务"; \
    Flags: runhidden; \
    Tasks: installservice

; 安装完成后尝试启动服务
Filename: "sc.exe"; \
    Parameters: "start WOLPService"; \
    Description: "启动 WOLP Windows 服务"; \
    Flags: runhidden; \
    Tasks: installservice

[UninstallRun]
; 在卸载时停止并删除服务
Filename: "sc.exe"; \
    Parameters: "stop WOLPService"; \
    StatusMsg: "停止 WOLPService 服务中..."; \
    Flags: runhidden

Filename: "sc.exe"; \
    Parameters: "delete WOLPService"; \
    StatusMsg: "删除 WOLPService 服务中..."; \
    Flags: runhidden
