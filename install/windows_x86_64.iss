; wolp.iss - Inno Setup Script
#define MyAppName "wolp"
#define MyAppExeName "wolp.exe"

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
Source: "{#SourcePath}\..\build\wolp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\client\webui\*"; DestDir: "{app}\webui"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\icon.ico"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#SourcePath}\wolp-service.xml"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 在开始菜单创建快捷方式
Name: "{group}\wolp"; Filename: "{app}\wolp.exe"; IconFilename: "{app}\icon.ico"

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "install";
Filename: "{app}\{#MyAppExeName}"; Parameters: "start";

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "stop";
Filename: "{app}\{#MyAppExeName}"; Parameters: "uninstall";

[UninstallDelete]
Type: files; Name: "{app}\wolp-service.log"

[Code]
function InitializeSetup() : Boolean;
var 
  ResultCode: Integer;
begin
  Result := True;
  Exec('cmd.exe', '/C sc.exe stop wolp', '', SW_HIDE, ewWaitUntilTerminated, ResultCode); 
end;