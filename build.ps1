# 设置Go项目的工作目录
$GoProjectDir = "C:\path\to\your\go\project"   # 修改为你的Go项目路径
$BuildDir = "$GoProjectDir\build"              # 存放构建结果的目录
$ExecutableName = "wolp.exe"                   # 可执行文件名称

# 确保构建目录存在
if (-not (Test-Path $BuildDir)) {
    New-Item -Path $BuildDir -ItemType Directory
}

# 进入Go项目目录
Set-Location -Path $GoProjectDir

# 清理已有的构建文件
Remove-Item "$BuildDir\$ExecutableName" -Force

# 设置Go环境变量，指定Windows目标平台
$env:GOOS = "windows"
$env:GOARCH = "amd64"

# 编译Go项目为可执行文件
Write-Host "Building project..."
go build -o "$BuildDir\$ExecutableName"

# 输出编译结果
if (Test-Path "$BuildDir\$ExecutableName") {
    Write-Host "Build succeeded! Executable: $BuildDir\$ExecutableName"
} else {
    Write-Host "Build failed!"
}

