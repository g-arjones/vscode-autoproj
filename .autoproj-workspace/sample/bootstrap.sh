#!/bin/sh

AUTOPROJ_INSTALL_URL=https://raw.githubusercontent.com/rock-core/autoproj/master/bin/autoproj_install

set -e

[ -f "autoproj_install" ] || wget -nv ${AUTOPROJ_INSTALL_URL}
ruby autoproj_install --gemfile=autoproj.gemfile --seed-config=seed-config.yml