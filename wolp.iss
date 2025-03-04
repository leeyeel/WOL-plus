; wolp.iss - Inno Setup Script
[Setup]
AppName=wolp
AppVersion=1.0.0
AppPublisher=leo
AppPublisherURL=https://github.com/leeyeel/WOL-plus    
; 输出安装包的文件名，默认输出到脚本所在目录
OutputBaseFilename=wolp_installer
DefaultDirName={commonpf}\wolp
DefaultGroupName=wolp
; 安装时请求管理员权限
PrivilegesRequired=admin
; 64位模式
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile="{#SourcePath}\icon.ico"

[Files]
; 可执行文件和前端文件都打包进来
; go build 的结果是 wolp.exe
Source: "{#SourcePath}\build\wolp.exe"; DestDir: "{app}"; Flags: ignoreversion
; webui 整个文件夹：
Source: "{#SourcePath}\client\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion
; icon.ico 图标文件
Source: "{#SourcePath}\icon.ico"; DestDir: "{app}"; Flags: onlyifdoesntexist

[Icons]
; 在开始菜单创建快捷方式
Name: "{group}\wolp"; Filename: "{app}\wolp.exe"; IconFilename: "{app}\icon.ico"

[Tasks]
; 定义一个任务用来创建桌面图标，可选
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "其他选项:"; Flags: unchecked
; 定义一个任务用来是否安装为服务
Name: "installservice"; Description: "安装为windows服务"; GroupDescription: "Service setup:"

[Run]
; 安装完成后自动运行可执行文件（可选）
; Filename: "{app}\wolp.exe"; Description: "启动 wolp"; Flags: nowait postinstall skipifsilent

; 在安装时通过 sc 命令创建 Windows 服务（仅当用户勾选了 installservice 时执行）
Filename: "sc.exe"; \
    Parameters: "create wolpService binPath= ""{app}\wolp.exe"" start=auto DisplayName= ""wolp Service"""; \
    Description: "创建 wolp Windows 服务"; \
    StatusMsg: "创建 wolpService 服务中..."; \
    Flags: runhidden waituntilterminated; \
    Tasks: installservice

; 安装完成后尝试启动服务
Filename: "sc.exe"; \
    Parameters: "start wolpService"; \
    Description: "启动 wolp Windows 服务"; \
    Flags: runhidden  waituntilterminated; \
    Tasks: installservice

[UninstallRun]
; 在卸载时停止并删除服务
Filename: "sc.exe"; \
    Parameters: "stop wolpService"; \
    RunOnceId: "StopWolp"; \
    StatusMsg: "停止 wolpService 服务中..."; \
    Flags: runhidden

Filename: "sc.exe"; \
    Parameters: "delete wolpService"; \
    RunOnceId: "deleteWolp"; \
    StatusMsg: "删除 wolpService 服务中..."; \
    Flags: runhidden
