#!/usr/bin/env bash
# 本机 slidep 引擎的真实入口：应用把引擎解压到 <node>/lib/node_modules/@tencent/slidep，
# 但 node 目录下的 slidep shim 指向 <node>/node_modules/...（路径不一致，会误报"引擎尚未就绪"）。
# 这里直接调引擎真身。
NODE="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
IDX="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/lib/node_modules/@tencent/slidep/dist/index.js"
exec "$NODE" "$IDX" "$@"
