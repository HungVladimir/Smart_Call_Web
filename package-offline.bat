@echo off
chcp 65001 >nul
echo ========================================================
echo   SMARTCALL WEB - ĐÓNG GÓI TRIỂN KHAI MÁY CHỦ CÔNG TY
echo ========================================================
echo.

echo [1/3] Đang biên dịch mã nguồn Vue 3 (Vite build)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [LỖI] Quá trình build thất bại! Xin kiểm tra lại mã nguồn.
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Kiểm tra thư mục dist/...
if exist dist\index.html (
    echo [OK] Thư mục dist/ đã sẵn sàng!
) else (
    echo [LỖI] Không tìm thấy dist/index.html!
    exit /b 1
)

echo.
echo [3/3] Hướng dẫn triển khai trên máy chủ công ty:
echo --------------------------------------------------------
echo CÁCH 1 (Nginx tĩnh):
echo   - Nén thư mục 'dist/' thành zip và đưa vào máy chủ.
echo   - Cấu hình Nginx trỏ root vào 'dist/' với HTTPS.
echo.
echo CÁCH 2 (Docker Image Offline):
echo   - Chạy lệnh: docker build -t smartcall-web:latest .
echo   - Chạy lệnh: docker save -o smartcall-web.tar smartcall-web:latest
echo   - Chép file 'smartcall-web.tar' vào máy chủ công ty.
echo   - Chạy lệnh: docker load -i smartcall-web.tar
echo   - Chạy lệnh: docker run -d -p 80:80 --name smartcall smartcall-web:latest
echo ========================================================
pause
