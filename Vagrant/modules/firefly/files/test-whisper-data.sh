#!/bin/bash

WSP_FILE=/var/lib/firefly/test.wsp

/usr/local/bin/whisper-create.py $WSP_FILE 60:1440 # 1 day retention

function update() {
    data=$(($RANDOM % 100))
    /usr/local/bin/whisper-update.py $WSP_FILE $(date "+%s"):$data;
}

while true; do
    update
    sleep 1
done
