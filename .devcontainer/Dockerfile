FROM ubuntu:24.04
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
                                   apt-get install -y --no-install-recommends dbus \
                                                                              gnupg \
                                                                              curl \
                                                                              wget \
                                                                              git \
                                                                              nodejs \
                                                                              npm \
                                                                              xvfb

RUN wget -qO- https://packages.microsoft.com/keys/microsoft.asc | \
    gpg --dearmor | \
    tee /etc/apt/keyrings/packages.microsoft.gpg >/dev/null && \
    echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" | \
    tee /etc/apt/sources.list.d/vscode.list >/dev/null && \
    DEBIAN_FRONTEND=noninteractive apt-get update && \
                                   apt-get install -y --no-install-recommends code

RUN apt-get clean && rm -rf /tmp/* /var/tmp/*
CMD /etc/init.d/dbus start && \
    su ubuntu -c " \
        dbus-daemon --fork --session --address='unix:abstract=/tmp/dbus-session' && \
        rm -rf /tmp/.X99-lock && \
        Xvfb :99 > /dev/null 2>&1"
