const LINE_NOTIFY_TOKEN = "<TOKEN_HERE>";
// Developer Tool > Network > do search > do filter "home/search/rsList"
const SEARCH_QUERY = ["https://rent.591.com.tw/home/search/rsList?is_format_data=1&is_new_list=1&type=1&region=4&kind=2&section=371,372,370&searchtype=1&rentprice=,10000&order=posttime&orderType=desc", "https://rent.591.com.tw/home/search/rsList?is_format_data=1&is_new_list=1&type=1&region=4&kind=3&section=371,372,370&searchtype=1&rentprice=,10000&order=posttime&orderType=desc"];

const MAX_ROW_OF_SHEET = 120;

class Crawler {
    constructor() {
        this.csrfToken = null;
        this.cookie = null;
        this.getCsrfToken();
    }
    get SEARCH_QUERY() {
        return SEARCH_QUERY;
    }
    get HOST_URL() {
        return "https://rent.591.com.tw/";
    }

    getCsrfToken() {
        let response = UrlFetchApp.fetch(this.HOST_URL);
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
        [this.csrfToken, this.cookie] = [csrfToken, cookie];
    }

    getRegionNum(query) {
        let regex = new RegExp(".*region=([0-9]*).*", "gi");
        let regionNumber = regex.exec(query)[1];
        return regionNumber;
    }

    crawling(searchQueryUrl) {
        let regionNumber = this.getRegionNum(searchQueryUrl);

        const header = {
            "X-CSRF-TOKEN": this.csrfToken,
            "Cookie": `${this.cookie}; urlJumpIp=${regionNumber};`,
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

    getCrawlingResult() {
        let rtn = []
        for (let i = 0; i < this.SEARCH_QUERY.length; i++) {
            let rlt = JSON.parse(this.crawling(this.SEARCH_QUERY[i]))["data"]["data"].map(({ title, post_id, price, location }) => ({ title, post_id, price: price.replace(',', ''), location, url: `https://rent.591.com.tw/rent-detail-${post_id}.html` }));
            rtn = [...rtn, ...rlt];
        }
        return rtn;
    }
}

class Sheet {
    constructor() {
        this.ss = SpreadsheetApp.getActiveSpreadsheet();
        this.sheet = this.ss.getSheets()[0];
    }

    get MAX_ROW_OF_SHEET() {
        return MAX_ROW_OF_SHEET;
    }

    get length() {
        // start from first row
        return this.sheet.getDataRange().getNumRows();
    }
    getSheet() {
        // This represents ALL the data  
        let range = this.sheet.getDataRange();
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
    push(newRow) {
        this.sheet.appendRow(Object.values(newRow));
    }
    pop() {
        const START_ROW = 2;
        this.sheet.deleteRow(START_ROW);
    }
    autoResize() {
        if (this.length <= this.MAX_ROW_OF_SHEET) return;
        const START_ROW = 2;
        this.sheet.deleteRows(START_ROW, this.length - this.MAX_ROW_OF_SHEET);
    }
}

class Notify {
    get LINE_NOTIFY_URL() {
        return "https://notify-api.line.me/api/notify";
    }

    get LINE_NOTIFY_TOKEN() {
        return LINE_NOTIFY_TOKEN;
    }

    sendLineNotify(message) {
        const header = {
            "Authorization": `Bearer ${this.LINE_NOTIFY_TOKEN}`,
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

        UrlFetchApp.fetch(this.LINE_NOTIFY_URL, options);
    }

    itemObjToMessage(item) {
        let itemMsg = JSON.parse(JSON.stringify(item));
        itemMsg.price = "$ " + itemMsg.price;
        delete itemMsg["post_id"];
        return '\n' + Object.values(itemMsg).join('\n');
    }

    makeNotify(newRows) {
        for (let i = 0; i < newRows.length; i++) {
            this.sendLineNotify(this.itemObjToMessage(newRows[i]));
        }
    }
}

function compareNewItem(dataCrawling, sheet) {
    let dataCurrent = sheet.getSheet();
    let newItems = [];
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

function storeNewItems(dataNew, sheet) {
    while (dataNew.length > 0) {
        sheet.push(dataNew[0]);
        dataNew.shift();
    }
    sheet.autoResize();
}

function main() {
    // let testData = {'title': '清大交大科學園區', 'post_id': 12731333, 'price': '5,200', 'location': '東區-金山六街', 'url': 'https://rent.591.com.tw/rent-detail-12731333.html'};
    const sheet = new Sheet();
    const crawler = new Crawler();
    const notifier = new Notify();
    let dataCrawling = crawler.getCrawlingResult().reverse();
    let dataNew = compareNewItem(dataCrawling, sheet);
    notifier.makeNotify(dataNew);
    storeNewItems(dataNew, sheet);
}