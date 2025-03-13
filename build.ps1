# 设置工作目录
$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Definition -Parent
$GoProjectDir = "$ScriptDir\client\src\"    # Go项目的源码路径
$BuildDir = "$ScriptDir\build"              # 存放构建结果的目录
$ExecutableName = "wolp.exe"                # 可执行文件名称 

function Build() {
    # 确保构建目录存在
    if (-not (Test-Path $BuildDir)) {
        New-Item -Path $BuildDir -ItemType Directory
    }
    # 进入Go项目目录
    Set-Location -Path $GoProjectDir

    # 清理已有的构建文件
    if (Test-Path "$BuildDir\$ExecutableName") {
        Remove-Item "$BuildDir\$ExecutableName" -Force
    }

    # 设置Go环境变量，指定Windows目标平台
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"

    # 编译Go项目为可执行文件
    Write-Host "Building project..."
    go mod tidy
    go build -o "$BuildDir\$ExecutableName"

    # 输出编译结果
    if (Test-Path "$BuildDir\$ExecutableName") {
        Write-Host "Build succeeded! Executable: $BuildDir\$ExecutableName"
    } else {
        Write-Host "Build failed!"
    }

    # 返回到上一级目录
    Set-Location -Path $ScriptDir
}

function Download() {
    # 设置文件路径和下载 URL
    $WinSWPath = "install\wolp-service.exe"
    $DownloadURL = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
    $TempDownloadPath = "$env:TEMP\WinSW-x64.exe"

    # 检查是否已经存在
    if (Test-Path $WinSWPath) {
        Write-Host "WinSW exists, no need to download again."
    } else {
        Write-Host "WinSW not exists, downloading from github..."
        try {
            # 使用 Invoke-WebRequest 下载文件
            Invoke-WebRequest -Uri $DownloadURL -OutFile $TempDownloadPath
            Write-Host "download success, rename it to wolp-service.exe..."

            # 确保目标目录存在
            $TargetDir = [System.IO.Path]::GetDirectoryName($WinSWPath)
            if (!(Test-Path $TargetDir)) {
                New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
            }

            # 移动文件并重命名
            Move-Item -Path $TempDownloadPath -Destination $WinSWPath -Force
            Write-Host "downloading WinSW success and rename it as wolp-service.exe"
        } catch {
            Write-Host "failed download, please check the internet" -ForegroundColor Red
            exit 1
        }
    }
}

Build
Download
