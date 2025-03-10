; wolp.iss - Inno Setup Script
#define MyAppName "wolp"
#define MyAppExeName "wolp-service.exe"
  

[Setup]
AppName={#MyAppName}
AppVersion=1.0.0
AppPublisher=leo
AppPublisherURL=https://github.com/leeyeel/WOL-plus    
; 输出安装包的文件名，默认输出到脚本所在目录
OutputBaseFilename=installer_windows_inno_x64
DefaultDirName={commonpf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; 安装时请求管理员权限
PrivilegesRequired=admin
; 64位模式
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile="{#SourcePath}\icon.ico"

[Files]
;先把文件复制过去，然后再执行命令
Source: "{#SourcePath}\..\build\wolp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\client\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\icon.ico"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#SourcePath}\wolp-service.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\wolp-service.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 在开始菜单创建快捷方式
Name: "{group}\wolp"; Filename: "{app}\wolp.exe"; IconFilename: "{app}\icon.ico"

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "install wolp-service.xml";
Filename: "{app}\{#MyAppExeName}"; Parameters: "start";

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "stop";Flags: runhidden; RunOnceId: "StopService";
Filename: "{app}\{#MyAppExeName}"; Parameters: "uninstall";Flags: runhidden; RunOnceId: "UninstallService"

[UninstallDelete]
Type: files; Name: "{app}\wolp-service.log"
Type: files; Name: "{app}\wolp-service.err.log"
Type: files; Name: "{app}\winsw.exe"
Type: files; Name: "{app}\wolp-service.xml"
Type: files; Name: "{app}\wolp.exe"
; 强制删除整个 {app} 
Type: dirifempty; Name: "{app}"