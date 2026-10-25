# 发行包：构建前把对应平台的 pb.zip 放到本目录（服务器/离线环境不依赖 GitHub 下载）
# 获取：从 https://github.com/pocketbase/pocketbase/releases 下载 pocketbase_<版本>_linux_<arch>.zip
FROM alpine:3.20
RUN apk add --no-cache unzip ca-certificates curl
COPY pb.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /usr/local/bin \
 && chmod +x /usr/local/bin/pocketbase \
 && rm /tmp/pb.zip
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
