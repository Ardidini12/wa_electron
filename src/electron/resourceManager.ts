import osUtils from 'os-utils';
import os from 'os';
import fs from 'fs';

const POLLING_INTERVAL = 500;

export function pollResources() {
    setInterval(async () => {
        const cpuUsage = await getCpuUsage();
        const ramUsage =  getRamUsage();
        const storageData =  getStorageData();
        // console.log({ cpuUsage, ramUsage, storageUsage: storageData.usage});
    }, POLLING_INTERVAL);
}

export function getStaticData() {
    const totalStorage = getStorageData().total;
    const cpuModel = os.cpus()[0].model;
    const totalMemoryGB = Math.floor(osUtils.totalmem() / 1024);

    return {
        totalStorage,
        cpuModel,
        totalMemoryGB
    };
}


function getCpuUsage() {
    return new Promise((resolve) => {
        osUtils.cpuUsage(resolve);
    });
}

function getRamUsage() {
    return 1 - osUtils.freememPercentage();
}

function getStorageData() {
    const stats = fs.statfsSync(process.platform === 'win32' ? 'C://' : '/');
    const total = stats.bsize * stats.blocks;
    const free = stats.bsize * stats.blocks;

    return { 
        total: Math.floor(total / 1_000_000_000),
        usage: 1 - free / total
    };
}