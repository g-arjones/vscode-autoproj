FROM ubuntu:24.04
ENV NODE_VERSION=20.19.5

RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
                                   apt-get install -y --no-install-recommends ca-certificates \
                                                                              dbus \
                                                                              git \
                                                                              gnupg \
                                                                              ssh \
                                                                              wget \
                                                                              xvfb \
                                                                              xz-utils

RUN wget -qO- https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | \
    tar Jxvf - -C /usr --strip-components 1

RUN wget -q -O /tmp/code.deb 'https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64' && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /tmp/code.deb && \
    apt-get clean && rm -rf /tmp/* /var/tmp/*

CMD ["/bin/bash", "-c", "/etc/init.d/dbus start && su ubuntu -c \" \
        dbus-daemon --fork --session --address='unix:abstract=/tmp/dbus-session' && \
        rm -rf /tmp/.X99-lock && \
        Xvfb :99 > /dev/null 2>&1\""]
