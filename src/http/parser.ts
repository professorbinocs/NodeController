"use strict";

const POGOProtos = require('../../pogo-protos');
import * as S2 from 'nodes2ts';
import { Request, Response } from 'express';
import { Account } from '../models/account';
import { Device } from '../models/device';
import { Pokemon } from '../models/pokemon';
import { InstanceController } from '../controllers/instances/instance-controller';
import { getCurrentTimestamp, base64_decode, snooze } from '../utils/util';
import { Digest } from '../data/digest';
import { logger } from '../utils/logger';

const DefaultTargetMaxDistance: number = 250;
const digest = new Digest();

let emptyCells = [];
let levelCache = {};

enum ItemId {
	ITEM_UNKNOWN = 0,
	ITEM_POKE_BALL = 1,
	ITEM_GREAT_BALL = 2,
	ITEM_ULTRA_BALL = 3,
	ITEM_MASTER_BALL = 4,
	ITEM_PREMIER_BALL = 5,
	ITEM_POTION = 101,
	ITEM_SUPER_POTION = 102,
	ITEM_HYPER_POTION = 103,
	ITEM_MAX_POTION = 104,
	ITEM_REVIVE = 201,
	ITEM_MAX_REVIVE = 202,
	ITEM_LUCKY_EGG = 301,
	ITEM_INCENSE_ORDINARY = 401,
	ITEM_INCENSE_SPICY = 402,
	ITEM_INCENSE_COOL = 403,
	ITEM_INCENSE_FLORAL = 404,
	ITEM_INCENSE_BELUGA_BOX = 405,
	ITEM_TROY_DISK = 501,
	ITEM_TROY_DISK_GLACIAL = 502,
	ITEM_TROY_DISK_MOSSY = 503,
	ITEM_TROY_DISK_MAGNETIC = 504,
	ITEM_X_ATTACK = 602,
	ITEM_X_DEFENSE = 603,
	ITEM_X_MIRACLE = 604,
	ITEM_RAZZ_BERRY = 701,
	ITEM_BLUK_BERRY = 702,
	ITEM_NANAB_BERRY = 703,
	ITEM_WEPAR_BERRY = 704,
	ITEM_PINAP_BERRY = 705,
	ITEM_GOLDEN_RAZZ_BERRY = 706,
	ITEM_GOLDEN_NANAB_BERRY = 707,
	ITEM_GOLDEN_PINAP_BERRY = 708,
	ITEM_POFFIN = 709,
	ITEM_SPECIAL_CAMERA = 801,
	ITEM_INCUBATOR_BASIC_UNLIMITED = 901,
	ITEM_INCUBATOR_BASIC = 902,
	ITEM_INCUBATOR_SUPER = 903,
	ITEM_POKEMON_STORAGE_UPGRADE = 1001,
	ITEM_ITEM_STORAGE_UPGRADE = 1002,
	ITEM_SUN_STONE = 1101,
	ITEM_KINGS_ROCK = 1102,
	ITEM_METAL_COAT = 1103,
	ITEM_DRAGON_SCALE = 1104,
	ITEM_UP_GRADE = 1105,
	ITEM_GEN4_EVOLUTION_STONE = 1106,
	ITEM_GEN5_EVOLUTION_STONE = 1107,
	ITEM_MOVE_REROLL_FAST_ATTACK = 1201,
	ITEM_MOVE_REROLL_SPECIAL_ATTACK = 1202,
	ITEM_RARE_CANDY = 1301,
	ITEM_FREE_RAID_TICKET = 1401,
	ITEM_PAID_RAID_TICKET = 1402,
	ITEM_LEGENDARY_RAID_TICKET = 1403,
	ITEM_STAR_PIECE = 1404,
	ITEM_FRIEND_GIFT_BOX = 1405,
	ITEM_TEAM_CHANGE = 1406,
	ITEM_LEADER_MAP_FRAGMENT = 1501,
	ITEM_LEADER_MAP = 1502,
	ITEM_GIOVANNI_MAP = 1503,
	ITEM_GLOBAL_EVENT_TICKET = 1600
}

/**
 * Webhook request handler class.
 */
class WebhookHandler {
    static AccountInventory = {};
    /**
     * Initialize new WebhookHandler object.
     */
    constructor(){
    }
    /**
     * Handle raw API data.
     * @param req 
     * @param res 
     */
    handleRawData(req: Request, res: Response) {
        _handleRawData(req, res);
    }
    /**
     * Handle device controller data.
     * @param req 
     * @param res 
     */
    handleControllerData(req: Request, res: Response) {
        _handleControllerData(req, res);
    }
}

/**
 * Handles the raw data endpoint.
 * @param {*} req 
 * @param {*} res 
 */
async function _handleRawData(req: Request, res: Response) {
    let jsonOpt = req.body;
    if (jsonOpt === undefined || jsonOpt === null) {
        logger.error("[Raw] Bad data");
        return res.sendStatus(400);
    }
    if (jsonOpt['payload']) {
        jsonOpt['contents'] = [jsonOpt];
    }

    let json = jsonOpt;
    let trainerLevel = parseInt(json["trainerlvl"] || json["trainerLevel"]) || 0;
    let username: string = json["username"];
    if (username && username.includes("Optional(")) {
        username = username.replace("Optional(\"", "");
        username = username.replace("\")", "");
    }
    if (username && trainerLevel > 0) {
        let oldLevel = levelCache[username];
        if (oldLevel !== trainerLevel) {
            await Account.setLevel(username, trainerLevel);
            levelCache[username] = trainerLevel
        }
    }
    let contents: any = json["contents"] || json["protos"] || json["gmo"];
    if (contents === undefined || contents === null) {
        logger.error("[Raw] Invalid GMO");
        return res.sendStatus(400);
    }
    let uuid: string = json["uuid"];
    let latTarget: number = json["lat_target"];
    let lonTarget: number = json["lon_target"];
    if (uuid && latTarget && lonTarget) {
        try {
            await Device.setLastLocation(uuid, latTarget, lonTarget);
        } catch (err) {
            logger.error(err);
        }
    }

    let pokemonEncounterId: string = json["pokemon_encounter_id"];
    let pokemonEncounterIdForEncounter: string = json["pokemon_encounter_id_for_encounter"];
    let targetMaxDistance = json["target_max_distance"] || json["target_max_distnace"] || DefaultTargetMaxDistance;

    let wildPokemons = [];
    let nearbyPokemons = [];
    let clientWeathers = [];
    let forts = [];
    let fortDetails = [];
    let gymInfos = [];
    let quests = [];
    let encounters = [];
    let cells = [];

    let isEmptyGMO: boolean = true;
    let isInvalidGMO: boolean = true;
    let containsGMO: boolean = false;
    let isMadData: boolean = false;

    contents.forEach((rawData: any) => {
        let data: any;
        let method: number;
        if (rawData["data"]) {
            data = rawData["data"];
            method = parseInt(rawData["method"]) || 106;
        } else if (rawData["payload"]) {
            data = rawData["payload"];
            method = parseInt(rawData["type"]) || 106;
            isMadData = true;
            username = "PogoDroid";
        } else {
            logger.error("[Raw] Unhandled proto:", rawData);
            return res.sendStatus(400);
        }

        switch (method) {
            case 2: // GetPlayerResponse
                try {
                    let gpr = POGOProtos.Networking.Responses.GetPlayerResponse.decode(base64_decode(data));
                    if (gpr) {
                        // TODO: Parse GetPlayerResponse
                        if (gpr.success) {
                            let data = gpr.player_data;
                            logger.debug("[Raw] GetPlayerData:", data);
                        }
                    } else {
                        logger.error("[Raw] Malformed GetPlayerResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode GetPlayerResponse");
                }
                break;
            case 4: // GetHoloInventoryResponse
                try {
                    let ghir = POGOProtos.Networking.Responses.GetHoloInventoryResponse.decode(base64_decode(data));
                    if (ghir) {
                        if (ghir.success) {
                            //parseInventory(username, ghir);
                            let delta = ghir.inventory_delta;
                            let originalTimestamp = Math.round(delta.original_timestamp_ms / 1000);
                            let newTimestamp = Math.round(delta.new_timestamp_ms / 1000);
                            let inventoryItems = delta.inventory_items;
                            if (inventoryItems) {
                                for (let i = 0; i < inventoryItems.length; i++) {
                                    let inventoryItem = inventoryItems[i];
                                    let itemData = inventoryItem.inventory_item_data;
                                    if (itemData) {
                                        let type = itemData["Type"];
                                        switch (type) {
                                            case "item":
                                                let item = itemData["item"];
                                                let itemId: ItemId = <ItemId>item.item_id;
                                                switch (itemId) {
                                                    case ItemId.ITEM_LUCKY_EGG: // Lucky Egg
                                                        logger.debug(`${username} lucky egg ${itemId.toString()} -> ${item.count}`);
                                                        break;
                                                    case ItemId.ITEM_TROY_DISK: // Normal Lure
                                                    case ItemId.ITEM_TROY_DISK_GLACIAL: // Glacial Lure
                                                    case ItemId.ITEM_TROY_DISK_MOSSY: // Mossy Lure
                                                    case ItemId.ITEM_TROY_DISK_MAGNETIC: // Magnetic Lure
                                                        logger.debug(`${username} lure module ${itemId.toString()} -> ${item.count}`);
                                                        break;
                                                    default:
                                                        //logger.debug("Inventory item found: " + itemId.toString() + " Count: " + item.count);
                                                        break;
                                                }
                                                // Update inventory items for account
                                                let user = WebhookHandler.AccountInventory[username];
                                                if (user) {
                                                    user["items"][itemId] = item.count;
                                                } else {
                                                    user = { items: { } };
                                                    user["items"][itemId] = item.count;
                                                }
                                                WebhookHandler.AccountInventory[username] = user;
                                                break;
                                            case "player_stats":
                                                let experience = parseInt(itemData.player_stats.experience) || 0;
                                                WebhookHandler.AccountInventory[username]["experience"] = experience;
                                                break;
                                            case "pokemon_data":
                                            case "pokedex_entry":
                                            case "player_currency":
                                            case "player_camera":
                                            case "inventory_upgrades":
                                            case "applied_items":
                                            case "egg_incubators":
                                            case "candy":
                                            case "quest":
                                            case "avatar_item":
                                            case "raid_tickets":
                                            case "quests":
                                            case "gift_boxes":
                                            case "beluga_incense":
                                            case "limited_purchase_sku_record":
                                            default:
                                                //logger.debug("Inventory type: " + itemData);
                                                break;
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        logger.error("[Raw] Malformed GetHoloInventoryResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode GetHoloInventoryResponse");
                }
                break;
            case 101: // FortSearchResponse
                try {
                    let fsr = POGOProtos.Networking.Responses.FortSearchResponse.decode(base64_decode(data));
                    if (fsr) {
                        if (fsr.challenge_quest && fsr.challenge_quest.quest) {
                            let quest = fsr.challenge_quest.quest;
                            quests.push(quest);
                        }
                    } else {
                        logger.error("[Raw] Malformed FortSearchResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode FortSearchResponse");
                }
                break;
            case 102: // EncounterResponse
                if (trainerLevel >= 30 || isMadData !== false) {
                    try {
                        let er = POGOProtos.Networking.Responses.EncounterResponse.decode(base64_decode(data));
                        if (er) {
                            encounters.push(er);
                        } else {
                            logger.error("[Raw] Malformed EncounterResponse");
                        }
                    } catch (err) {
                        logger.error("[Raw] Unable to decode EncounterResponse");
                    }
                }
                break;
            case 104: // FortDetailsResponse
                try {
                    let fdr = POGOProtos.Networking.Responses.FortDetailsResponse.decode(base64_decode(data));
                    if (fdr) {
                        fortDetails.push(fdr);
                    } else {
                        logger.error("[Raw] Malformed FortDetailsResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode FortDetailsResponse");
                }
                break;
            case 156: // GymGetInfoResponse
                try {
                    let ggi = POGOProtos.Networking.Responses.GymGetInfoResponse.decode(base64_decode(data));
                    if (ggi) {
                        gymInfos.push(ggi);
                    } else {
                        logger.error("[Raw] Malformed GymGetInfoResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode GymGetInfoResponse");
                }
                break;
            case 106: // GetMapObjectsResponse
                containsGMO = true;
                try {
                    let gmo = POGOProtos.Networking.Responses.GetMapObjectsResponse.decode(base64_decode(data));
                    if (gmo) {
                        isInvalidGMO = false;
                        let mapCellsNew = gmo.map_cells;
                        if (mapCellsNew.length === 0) {
                            logger.debug("[Raw] Map cells is empty");
                            return res.sendStatus(400);
                        }
                        mapCellsNew.forEach((mapCell: any) => {
                            let timestampMs = mapCell.current_timestamp_ms;
                            let wildNew = mapCell.wild_pokemons;
                            wildNew.forEach((wildPokemon: any) => {
                                wildPokemons.push({
                                    cell: mapCell.s2_cell_id,
                                    data: wildPokemon,
                                    timestampMs: timestampMs
                                });
                            });
                            let nearbyNew = mapCell.nearby_pokemons;
                            nearbyNew.forEach((nearbyPokemon: any) => {
                                nearbyPokemons.push({
                                    cell: mapCell.s2_cell_id,
                                    data: nearbyPokemon
                                });
                            });
                            let fortsNew = mapCell.forts;
                            fortsNew.forEach((fort: any) => {
                                forts.push({
                                    cell: mapCell.s2_cell_id,
                                    data: fort
                                });
                            });
                            cells.push(mapCell.s2_cell_id);
                        });
        
                        let weather = gmo.client_weather;
                        weather.forEach((wmapCell: any) => {
                            clientWeathers.push({
                                cell: wmapCell.s2_cell_id,
                                data: wmapCell
                            });
                        });
        
                        if (wildPokemons.length === 0 && nearbyPokemons.length === 0 && forts.length === 0) {
                            cells.forEach((cell: any) => {
                                let count = emptyCells[cell];
                                if (count === undefined) {
                                    emptyCells[cell] = 1;
                                } else {
                                    emptyCells[cell] = count + 1;
                                }
                                if (count === 3) {
                                    logger.debug("[Raw] Cell" + cell + "was empty 3 times in a row. Assuming empty.");
                                    cells.push(cell);
                                }
                            });
                            
                            logger.debug("[Raw] GMO is empty.");
                        } else {
                            cells.forEach(cell => emptyCells[cell] = 0);
                            isEmptyGMO = false;
                        }
                    } else {
                        logger.error("[Raw] Malformed GetMapObjectsResponse");
                    }
                } catch (err) {
                    logger.error("[Raw] Unable to decode GetMapObjectsResponse");
                }
                break;
            default:
                logger.error("[Raw] Invalid method provided: " + method);
                return;
        }
    });

    let targetCoord: S2.S2LatLng;
    let inArea: boolean = false
    if (latTarget && lonTarget) {
        targetCoord = new S2.S2LatLng(latTarget, lonTarget);
    } else {
        targetCoord = null;
    }
    
    let pokemonCoords: S2.S2LatLng;
    if (targetCoord) {
        if (forts) {
            forts.forEach(fort => {
                if (inArea === false) {
                    let coord = new S2.S2LatLng(fort.data.latitude, fort.data.longitude);
                    if (coord.getDistance(targetCoord) <= targetMaxDistance) {
                        inArea = true;
                    }
                }
            });
        }
    }
    if (targetCoord || pokemonEncounterId) {
        wildPokemons.forEach(pokemon => {
            if (targetCoord) {
                if (inArea === false) {
                    let coord: S2.S2LatLng = new S2.S2LatLng(pokemon.data.latitude, pokemon.data.longitude);
                    if (coord.getDistance(targetCoord) <= targetMaxDistance) {
                        inArea = true;
                    }
                } else if (pokemonCoords && inArea) {
                    //break;
                }
            }
            if (pokemonEncounterId) {
                if (pokemonCoords === undefined) {
                    if (pokemon.data.encounter_id == pokemonEncounterId) {
                        pokemonCoords = new S2.S2LatLng(pokemon.data.latitude, pokemon.data.longitude);
                    }
                } else if (pokemonCoords && inArea) {
                    //break;
                }
            }
        });
    }
    if (targetCoord && inArea === false) {
        cells.forEach(cell => {
            if (inArea === false) {
                let s2cellId = new S2.S2CellId(cell.toString());
                let s2cell = new S2.S2Cell(s2cellId);
                let center = s2cell.getCenter();
                let coord = new S2.S2LatLng(center.x, center.y);
                let radians: S2.S1Angle = new S2.S1Angle(Math.max(targetMaxDistance, 100)); // REVIEW: wth is radians
                if (coord.getDistance(targetCoord) <= radians) {
                    inArea = true;
                }
            }
        });
    }

    let data = {
        "nearby": nearbyPokemons.length,
        "wild": wildPokemons.length,
        "forts": forts.length,
        "quests": quests.length,
        "encounters": encounters.length,
        "level": trainerLevel,
        "only_empty_gmos": containsGMO && isEmptyGMO,
        "only_invalid_gmos": containsGMO && isInvalidGMO,
        "contains_gmos": containsGMO
    };

    if (pokemonEncounterIdForEncounter) {
        //If the UIC sets pokemon_encounter_id_for_encounter,
        //only return encounters != 0 if we actually encounter that target.
        //"Guaranteed scan"
        data["encounters"] = 0;
        encounters.forEach(encounter => {
            if (encounter.wild_pokemon.encounter_id.toString() === pokemonEncounterIdForEncounter){
                //We actually encountered the target.
                data["encounters"] = 1;
            }
        });
    }    
    if (latTarget && lonTarget) {
        data["in_area"] = inArea;
        data["lat_target"] = latTarget;
        data["lon_target"] = lonTarget;
    }
    if (pokemonCoords && pokemonEncounterId) {
        let point = pokemonCoords.toPoint();
        // TODO: Confirm lat/lon values are correct.
        data["pokemon_lat"] = pokemonCoords.latDegrees;
        data["pokemon_lon"] = pokemonCoords.lngDegrees;
        data["pokemon_encounter_id"] = pokemonEncounterId;
    }

    let listScatterPokemon = json["list_scatter_pokemon"];
    if (listScatterPokemon && pokemonCoords && pokemonEncounterId) {
        let uuid: string = json["uuid"];
        let controller = InstanceController.instance.getInstanceController(uuid); // TODO: Cast to IVInstanceController
        let scatterPokemon = [];

        wildPokemons.forEach(async pokemon => {
            //Don't return the main query in the scattershot list
            if (pokemon.data.encounter_id === pokemonEncounterId) {
                return;
            }            
            try {
                let oldPokemon = await Pokemon.getById(pokemon.data.encounter_id);
                if (oldPokemon && oldPokemon.atkIv) {
                    //Skip going to mons already with IVs.
                    return;
                }
            } catch {}
            
            let coords: S2.S2LatLng = new S2.S2LatLng(pokemon.data.latitude, pokemon.data.longitude);
            let distance = pokemonCoords.getDistance(coords);
            
            // Only Encounter pokemon within 35m of initial pokemon scann
            let pokemonId: number = parseInt(pokemon.data.pokemon_data.pokemon_id);
            if (controller) {
                let radians: S2.S1Angle = new S2.S1Angle(35); // REVIEW: wth is radians
                /*
                TODO: Fix scatterPokemon
                if (distance <= radians && controller.scatterPokemon.contains(pokemonId)) {
                    scatterPokemon.push({
                        lat: pokemon.data.latitude,
                        lon: pokemon.data.longitude,
                        id: pokemon.data.encounterID.description
                    });
                }
                */
            }
        });
        data["scatter_pokemon"] = scatterPokemon;
    }

    if (data) {
        try {
            //logger.debug("[Raw] Sending response to device:", data);
            res.send(data);
        } catch (err) {
            // TODO: ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent to the client
            logger.error("[Raw] Failed to reply to device:", err);
        }
    }

    /*
    await digest.consumeCells(cells).then(async () => {
        await digest.consumeClientWeather(clientWeathers).then(async () => {
            await digest.consumeForts(forts).then(async () => {
                await digest.consumeFortDetails(fortDetails).then(async () => {
                    await digest.consumeGymInfos(gymInfos).then(async () => {
                        await digest.consumeQuests(quests).then(async () => {
                            await digest.consumeWildPokemon(wildPokemons, username).then(async () => {
                                await digest.consumeNearbyPokemon(nearbyPokemons, username).then(async () => {
                                    await digest.consumeEncounters(encounters, username);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
    */
    await digest.consumeCells(cells)
    await digest.consumeClientWeather(clientWeathers);
    await digest.consumeNearbyPokemon(nearbyPokemons, username);
    await digest.consumeWildPokemon(wildPokemons, username);
    await digest.consumeForts(forts);
    await digest.consumeFortDetails(fortDetails);
    await digest.consumeGymInfos(gymInfos);
    await digest.consumeQuests(quests);
    await digest.consumeEncounters(encounters, username);
}

/**
 * Handles the controller endpoint.
 * @param {*} req 
 * @param {*} res 
 */
async function _handleControllerData(req: Request, res: Response) {
    let jsonO = req.body;
    let typeO = jsonO["type"];
    let uuidO = jsonO["uuid"];
    if (typeO === undefined || uuidO === undefined) {
        logger.error("[Controller] Failed to parse controller data");
        return res.sendStatus(400);
    }
    let type: string = typeO;
    let uuid: string = uuidO;
    let username: string = jsonO["username"];
    let ptcToken: string = jsonO["ptcToken"];
    //let tutorial: number = parseInt(jsonO["tutorial"]);
    let minLevel: number = parseInt(jsonO["min_level"] || 0);
    let maxLevel: number = parseInt(jsonO["max_level"] || 29);
    let device = await Device.getById(uuid);

    switch (type) {
        case "init":
            let firstWarningTimestamp: number;
            if (device === undefined || device.accountUsername === undefined) {
                firstWarningTimestamp = null;
            } else {
                let account = await Account.getWithUsername(device.accountUsername);
                if (account instanceof Account) {
                    firstWarningTimestamp = account.firstWarningTimestamp;
                } else {
                    firstWarningTimestamp = null;
                }
            }
            if (device instanceof Device) {
                // Device is already registered
                logger.debug("[Controller] Device already registered");
                res.send({
                    data: {
                        assigned: device.instanceName !== undefined && device.instanceName !== null && device.instanceName !== "",
                        first_warning_timestamp: firstWarningTimestamp
                    }
                });
            } else {
                // Register new device
                logger.debug("[Controller] Registering device");
                let newDevice = new Device(uuid, null, null, 0, null, 0, 0.0, 0.0, null);
                await newDevice.create();
                res.send({ 
                    data: { 
                        assigned: false,
                        first_warning_timestamp: firstWarningTimestamp
                    }
                });
            }
            break;
        case "heartbeat":
            let client = req.socket;
            let host = client 
                ? `${client.remoteAddress}:${client.remotePort}` 
                : "?";
            try {
                await Device.touch(uuid, host, false);
                res.send('OK');
            } catch (err) {
                res.send(err);
            }
            break;
        case "get_job":
            let controller = InstanceController.instance.getInstanceController(uuid);
            if (controller) {
                try {
                    let task = controller.getTask(uuid, username, false);
                    res.send({
                        data: task
                    });
                } catch (err) {
                    return res.sendStatus(404);
                }
            } else {
                logger.info("[Controller] Device " + uuid + "not assigned to an instance!");
                return res.sendStatus(404);
            }
            break;
        case "get_startup":
            let startupController = InstanceController.instance.getInstanceController(uuid);
            if (startupController) {
                try {
                    let task = startupController.getTask(uuid, username, true);
                    res.send({
                        data: task
                    });
                } catch (err) {
                    return res.sendStatus(404);
                }
            } else {
                logger.info("[Controller] Device" + uuid + " failed to get startup location!");
                return res.sendStatus(404);
            }
            break;
        case "get_account":
            let account = await Account.getNewAccount(minLevel, maxLevel);
            logger.debug("[Controller] GetAccount: " + account);
            if (device === undefined || device === null || 
                account === undefined || account === null) {
                logger.error("[Controller] Failed to get account, device or account is null.");
                return res.sendStatus(400);
            }
            if (device.accountUsername) {
                let oldAccount = await Account.getWithUsername(device.accountUsername);
                if (oldAccount instanceof Account && 
                    oldAccount.level >= minLevel &&
                    oldAccount.level <= maxLevel &&
                    oldAccount.firstWarningTimestamp === undefined && 
                    oldAccount.failed                === undefined && 
                    oldAccount.failedTimestamp       === undefined) {
                    res.send({
                        data: {
                            username: oldAccount.username.trim(),
                            password: oldAccount.password.trim(),
                            first_warning_timestamp: oldAccount.firstWarningTimestamp,
                            level: oldAccount.level,
                            tutorial: account.tutorial,
                            ptcToken: oldAccount.ptcToken
                        }
                    });
                    return;
                }
            }

            device.accountUsername = account.username;
            device.deviceLevel = account.level;
            await device.save(device.uuid);
            res.send({
                data: {
                    username: account.username.trim(),
                    password: account.password.trim(),
                    first_warning_timestamp: account.firstWarningTimestamp,
                    level: account.level,
                    tutorial: account.tutorial,
                    ptcToken: account.ptcToken
                }
            });
            break;
        case "last_seen":
            let lastSeenClient = req.socket;
            let lastSeenHost = lastSeenClient 
                ? `${lastSeenClient.remoteAddress}:${lastSeenClient.remotePort}` 
                : "?";
            try {
                await Device.touch(uuid, lastSeenHost, true);
                res.send('OK');
            } catch (err) {
                res.send(err);
            }
            break;
        case "tutorial_done":
            let tutAccount = await Account.getWithUsername(device.accountUsername);
            if (tutAccount instanceof Account) {
                if (tutAccount.level === 0) {
                    tutAccount.level = 1;
                }
                tutAccount.tutorial = 1;
                await tutAccount.save(true);
                res.send('OK');
            } else {
                if (device === undefined || device === null || 
                    tutAccount === undefined || tutAccount === null) {
                    logger.error("[Controller] Failed to get account, device or account is null.");
                    return res.sendStatus(400);
                }
            }
            break;
        case "account_banned":
            let banAccount = await Account.getWithUsername(device.accountUsername);
            if (banAccount instanceof Account) {
                if (banAccount.failedTimestamp === undefined || banAccount.failedTimestamp === null || 
                    banAccount.failed === undefined || banAccount.failed === null) {
                        banAccount.failedTimestamp = getCurrentTimestamp();
                        banAccount.failed = "banned";
                        await banAccount.save(true);
                        res.send('OK');
                }
            } else {
                if (device === undefined || device === null ||
                    banAccount === undefined || banAccount === null) {
                    logger.error("[Controller] Failed to get account, device or account is null.");
                    return res.sendStatus(400);
                }
            }
            break;
        case "account_warning":
            let warnAccount = await Account.getWithUsername(device.accountUsername);
            if (warnAccount instanceof Account) {
                if (warnAccount.firstWarningTimestamp === undefined || warnAccount.firstWarningTimestamp === null) {
                    warnAccount.firstWarningTimestamp = getCurrentTimestamp();
                    await warnAccount.save(true);
                    res.send('OK');
                }
            } else {
                if (device === undefined || device === null ||
                    warnAccount === undefined || warnAccount === null) {
                    logger.error("[Controller] Failed to get account, device or account is null.");
                    return res.sendStatus(400);
                }
            }
            break;
        case "account_invalid_credentials":
            let invalidAccount = await Account.getWithUsername(device.accountUsername);
            if (invalidAccount instanceof Account) {
                if (invalidAccount.failedTimestamp === undefined || invalidAccount.failedTimestamp === null || 
                    invalidAccount.failed === undefined || invalidAccount.failed === null) {
                        invalidAccount.failedTimestamp = getCurrentTimestamp();
                        invalidAccount.failed = "invalid_credentials";
                        await invalidAccount.save(true);
                        res.send('OK');
                }
            } else {
                if (device === undefined || device === null ||
                    invalidAccount === undefined || invalidAccount === null) {
                    logger.error("[Controller] Failed to get account, device or account is null.");
                    return res.sendStatus(400);
                }
            }
            break;
        case "error_26":
            let errAccount = await Account.getWithUsername(device.accountUsername);
            if (errAccount instanceof Account) {
                if (errAccount.failedTimestamp === undefined || errAccount.failedTimestamp === null ||
                    errAccount.failed === undefined || account.failed === null) {
                        errAccount.failedTimestamp = getCurrentTimestamp();
                        errAccount.failed = "error_26";
                        errAccount.save(true);
                        res.send('OK');
                }
            } else {
                if (device === undefined || device === null ||
                    errAccount === undefined || errAccount === null) {
                    logger.error("[Controller] Failed to get account, device or account is null.");
                    return res.sendStatus(400);
                }
            }
            break;
        case "logged_out":
            try {
                let device = await Device.getById(uuid);
                if (device instanceof Device) {
                    if (device.accountUsername === null) {
                        return res.sendStatus(404);
                    }
                    let failed = await Account.checkFail(device.accountUsername);
                    if (failed === false) {
                        await Account.setInstanceUuid(device.uuid, device.instanceName, device.accountUsername);
                    }
                    await Account.setCooldown(device.accountUsername, device.lastLat, device.lastLon);
                    device.accountUsername = null;
                    await device.save(device.uuid);
                    res.send('OK');
                } else {
                    return res.sendStatus(404);
                }
            } catch {
                return res.sendStatus(500);
            }
            //device.accountUsername = null;
            //device.save(device.uuid);
            //res.send('OK');
            break;
        case "ptcToken": // REVIEW: Seriously? Who the hell used camelCasing :joy:?
            try {
                let device = await Device.getById(uuid);
                let username = device.accountUsername;
                let account = await Account.getWithUsername(username);
                if (device === undefined || device === null ||
                    username === undefined || username === null || username === "" ||
                    account === undefined || account === null) {
                        return res.sendStatus(404);
                }
                if (account.ptcToken === undefined || 
                    account.ptcToken === null ||
                    account.ptcToken === "") {
                    account.ptcToken = ptcToken;
                    await account.save(true);
                }
                res.send('OK');
            } catch {
                return res.sendStatus(404);
            }
            break;
        case "job_failed":
            logger.error("[Controller] JOB FAILED:", jsonO);
            res.send('OK');
            break;
        default:
            logger.error("[Controller] Unhandled Request:", type);
            return res.sendStatus(404);
    }
}

// Export the class
export { WebhookHandler };