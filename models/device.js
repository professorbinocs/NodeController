"use strict"

const devicesPath = '../devices.json';
//const devices     = require(devicesPath);
const fs          = require('fs');

// Constructor
class Device {
    constructor(name, instanceName, accountUsername, lastHost, lastSeen, lastLat, lastLon) {
        this.name = name;
        this.instanceName = instanceName;
        this.accountUsername = accountUsername;
        this.lastHost = lastHost;
        this.lastSeen = lastSeen;
        this.lastLat = lastLat;
        this.lastLon = lastLon;
    }
    static getAll() {
        //return devices;
        return this.load();
    }
    save() {
        var devices = Device.getAll();
        if (devices[this.name] !== undefined) {
            devices.push({
                uuid: this.name,
                instanceName: this.instanceName,
                accountUsername: this.accountUsername,
                lastHost: this.lastHost,
                lastSeen: this.lastSeen,
                lastLat: this.lastLat,
                lastLon: this.lastLon
            });
            save(devices, devicesPath);
        }
    }
    static load() {
        var data = fs.readFileSync(devicesPath);
        var obj = JSON.parse(data);
        var deviceList = []
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                var dev = obj[key];
                deviceList.push(new Device(dev.uuid, dev.instanceName, dev.lastHost, dev.lastSeen, dev.lastLat, dev.lastLon));
            }
        };
        return deviceList;
    }
}

/**
 * Save object as json string to file path.
 * @param {*} obj 
 * @param {*} path 
 */
function save(obj, path) {
    fs.writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
}

// Export the class
module.exports = Device;