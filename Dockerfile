# Dockerfile đóng gói SmartCall Web chạy trên máy chủ công ty
# 100% tệp tĩnh (Static Assets), không phụ thuộc Node.js hay node_modules ở runtime
FROM nginx:alpine

# Sao chép thư mục dist đã biên dịch vào thư mục web root của Nginx
COPY dist /usr/share/nginx/html

# Sao chép cấu hình Nginx tối ưu cho Vue 3 SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
