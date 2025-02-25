$WolpPath = "C:\Program Files\wolp"
$ServiceName = "WolpService"

# 停止并删除 Windows 服务
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force
    sc.exe delete $ServiceName
}

# 删除文件和目录
Remove-Item -Path $WolpPath -Recurse -Force

Write-Output "WOLP uninstalled successfully!"

