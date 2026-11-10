#!/bin/sh
# The mediasoup worker pinned to core 0 of the container, like on the VPS: one
# worker, one core. The `exec` keeps file descriptors 3 and 4 (the channel with
# Node).
exec taskset -c 0 /ms/node_modules/mediasoup/worker/out/Release/mediasoup-worker "$@"
