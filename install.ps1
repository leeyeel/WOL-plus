$WolpPath = "C:\Program Files\wolp"
$BinPath = "$WolpPath\wolp.exe"
$ConfigPath = "$WolpPath\wolp.json"
$ServiceName = "WolpService"

# 创建安装目录
if (!(Test-Path $WolpPath)) {
    New-Item -ItemType Directory -Path $WolpPath | Out-Null
}

# 复制可执行文件和配置文件
Copy-Item .\wolp.exe $BinPath -Force
Copy-Item .\wolp.json $ConfigPath -Force

# 安装 Web UI
$WebUIPath = "$WolpPath\openwrt"
if (!(Test-Path $WebUIPath)) {
    New-Item -ItemType Directory -Path $WebUIPath | Out-Null
}
Copy-Item .\openwrt\index.html $WebUIPath\index.html -Force
Copy-Item .\openwrt\style.css $WebUIPath\style.css -Force

# 创建 Windows 服务
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force
    sc.exe delete $ServiceName
}

sc.exe create $ServiceName binPath= "$BinPath" DisplayName= "WOL Packet Listener" start= auto
Start-Service -Name $ServiceName

Write-Output "WOLP installed successfully!"
