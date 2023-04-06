const LINE_NOTIFY_TOKEN = "<TOKEN_HERE>";
// Developer Tool > Network > do search > do filter "home/search/rsList"
const SEARCH_QUERY = ["https://rent.591.com.tw/home/search/rsList?is_format_data=1&is_new_list=1&type=1&region=4&kind=2&section=371,372,370&searchtype=1&rentprice=,10000&order=posttime&orderType=desc", "https://rent.591.com.tw/home/search/rsList?is_format_data=1&is_new_list=1&type=1&region=4&kind=3&section=371,372,370&searchtype=1&rentprice=,10000&order=posttime&orderType=desc"];

var ss = SpreadsheetApp.getActiveSpreadsheet();
var sheet = ss.getSheets()[0];
const MAX_ROW_OF_SHEET = 100;

function getCsrfToken() {
    const rent591_url = "https://rent.591.com.tw/"
    let response = UrlFetchApp.fetch(rent591_url);
    let regex = new RegExp("<meta name=\"csrf-token\" content=\"([A-Za-z0-9]*)\">", "gi");
    let csrfToken = regex.exec(response)[1];
    const setCookie = response.getAllHeaders()["Set-Cookie"];
    let cookie;
    for (let i = 0; i < setCookie.length; i++) {
        if (setCookie[i].includes("591_new_session")) {
            cookie = setCookie[i];
            break;
        }
    }

    return [csrfToken, cookie]
}

function getRegionNum(query) {
    let regex = new RegExp(".*region=([0-9]*).*", "gi");
    let regionNumber = regex.exec(query)[1];

    return regionNumber;
}

function crawling(searchQueryUrl) {
    const [csrfToken, cookie] = getCsrfToken();
    let regionNumber = getRegionNum(searchQueryUrl);

    const header = {
        "X-CSRF-TOKEN": csrfToken,
        "Cookie": `${cookie}; urlJumpIp=${regionNumber};`,
        'Content-Type': 'application/json'
    }

    const options = {
        "method": "get",
        "headers": header,
        "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(searchQueryUrl, options);
    return response.getContentText();
}

function getCrawlingResult() {
    let rtn = []
    for (let i = 0; i < SEARCH_QUERY.length; i++) {
        let rlt = JSON.parse(crawling(SEARCH_QUERY[i]))["data"]["data"].map(({ title, post_id, price, location }) => ({ title, post_id, price: price.replace(',', ''), location, url: `https://rent.591.com.tw/rent-detail-${post_id}.html` }));
        rtn = [...rtn, ...rlt];
    }
    return rtn;
}

function getCurrentItems() {
    // This represents ALL the data
    let range = sheet.getDataRange();
    let values = range.getValues();

    let houses = []
    for (var i = 1; i < values.length; i++) {
        // console.log(values[i])
        const listKey = ['title', 'post_id', 'price', 'location', 'url'];
        const listValue = values[i];
        const house = listKey.reduce((obj, key, index) => ({...obj, [key]: listValue[index] }), {});
        houses.push(house);
    }
    return houses;
}

function compareNewItem(dataCurrent, dataCrawling) {
    let newItems = []
    for (let i = 0; i < dataCrawling.length; i++) {
        let dcrawling = dataCrawling[i];
        let duplicated = false;
        for (let j = 0; j < dataCurrent.length; j++) {
            let dcurrent = dataCurrent[j];
            if (dcrawling.post_id == dcurrent.post_id) {
                if (dcrawling.price == dcurrent.price) {
                    duplicated = true;
                    break;
                }
            }
        }
        if (duplicated) continue;
        console.log(`Crawling New: ${dcrawling.post_id}`);
        newItems.push(dcrawling);
    }
    return newItems;
}

function storeNewItems(dataNew, dataCurrent) {
    let itemsStored = [...dataNew, ...dataCurrent];
    itemsStored = itemsStored.slice(0, MAX_ROW_OF_SHEET);

    // clean all data
    const START_ROW = 2;
    const N_ROWS = sheet.getDataRange().getValues().length - 1;
    if (N_ROWS > START_ROW)
        sheet.deleteRows(START_ROW, N_ROWS);

    // append the lastest nMax_ROW data
    for (let i = 0; i < itemsStored.length; i++) {
        let rlt = itemsStored[i];
        Logger.log(`Stored: ${rlt.post_id}`);
        sheet.appendRow(Object.values(rlt));
    }
}

function itemObjToMessage(item) {
    let itemMsg = JSON.parse(JSON.stringify(item));
    itemMsg.price = "$ " + itemMsg.price;
    delete itemMsg["post_id"];
    return '\n' + Object.values(itemMsg).join('\n');
}

function sendLineNotify(message) {
    const lineNotifyUrl = "https://notify-api.line.me/api/notify";

    const header = {
        "Authorization": `Bearer ${LINE_NOTIFY_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
    }

    const payload = {
        "message": message,
    }

    const options = {
        "method": "post",
        "headers": header,
        "payload": payload,
        "muteHttpExceptions": true
    };

    UrlFetchApp.fetch(lineNotifyUrl, options);
}

function makeNotify(dataNew) {
    for (let i = 0; i < dataNew.length; i++) {
        sendLineNotify(itemObjToMessage(dataNew[i]));
    }
}


function main() {
    // let tmp = {'title': '清大交大科學園區', 'post_id': 12731333, 'price': '5,200', 'location': '東區-金山六街', 'url': 'https://rent.591.com.tw/rent-detail-12731333.html'}

    let dataCrawling = getCrawlingResult();
    let dataCurrent = getCurrentItems();
    let dataNew = compareNewItem(dataCurrent, dataCrawling);
    makeNotify(dataNew);
    storeNewItems(dataNew, dataCurrent);
}