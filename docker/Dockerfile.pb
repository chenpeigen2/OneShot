FROM alpine:3.20
ARG PB_VERSION=0.40.6
ARG TARGETARCH
RUN apk add --no-cache unzip ca-certificates curl \
 && case "$TARGETARCH" in amd64) PB_ARCH=amd64;; arm64) PB_ARCH=arm64;; *) PB_ARCH=amd64;; esac \
 && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" -o /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /usr/local/bin \
 && chmod +x /usr/local/bin/pocketbase \
 && rm /tmp/pb.zip
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
