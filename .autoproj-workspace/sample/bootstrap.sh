#!/bin/sh

AUTOPROJ_INSTALL_URL=https://raw.githubusercontent.com/rock-core/autoproj/master/bin/autoproj_install

set -e

[ -f "autoproj_install" ] || wget -nv ${AUTOPROJ_INSTALL_URL}
[ -d ".autoproj" ] || { mkdir -p .autoproj; cat <<EOF > .autoproj/config.yml; }
---
apt_dpkg_update: false
osdeps_mode: all
USE_PYTHON: true
python_executable: "/usr/bin/python3"
python_version: '3.8'
EOF

ruby autoproj_install --gemfile=autoproj.gemfile