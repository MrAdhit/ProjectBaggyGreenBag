const puppeteer = require("puppeteer");
const fs = require("fs");
const EventEmitter = require("events");
const fss = fs.promises;
const csv = require("csv-parser");
const log4js = require("log4js");

const config = require("./config.json");
const eventEmitter = new EventEmitter();
const date = new Date().toISOString().replace(/:/g, "-");
let id = 0;

log4js.configure({
    appenders: {
        everything: {
            type: "multiFile",
            base: "logs/",
            property: "browserID",
            extension: ".log"
        },
        console: {
            type: "console"
        }
    },
    categories: {
        default: {
            appenders: ["everything", "console"], level: "debug"
        }
    }
});
config.maxBrowser--;

let browserList = new Map();

(async () => {
    let dataRes = [];
    fs.createReadStream("data.csv")
        .pipe(csv())
        .on("data", (data) => dataRes.push(data))
        .on("end" , () => {
            dataRes.forEach((data) => {
                runThis(data);
            });
        });
})();

function runThis(data){
    if(browserList.size > config.maxBrowser){
        setTimeout(() => {
            runThis(data);
        }, 1000);
        return;
    }
    id++;
    browserList.set(`browser${id}`, true);
    openBrowser(data, `browser${id}`);
}

async function openBrowser(input, id){
    const logger = log4js.getLogger(id);
    logger.addContext("browserID", date);

    logger.info(`Membuka Browser`);
    const browser = await puppeteer.launch({headless: false, args: ["--disable-site-isolation-trials"]});
    browserList.set(id, true);

    try{
        const page = await browser.newPage();

        logger.info(`Mengatur Cookies`);
        let cookies = await fss.readFile(input.akun);
        cookies = JSON.parse(cookies);
        await page.setCookie(...cookies.cookies);

        logger.info(`Menuju "${input.produk}"`);
        await page.goto(input.produk);

        logger.info(`Sukses menuju "${input.produk}"`);

        let isVariant = true;
        let variantType = 1;
        let note = (typeof(input.note) == "undefined" ? config.note : input.note);
        let jumlahCustom = (typeof(input.jumlah) == "undefined" | input.jumlah <= 1 ? false : true);

        try{
            await page.waitForSelector("#pdpVariantContainer > div", {timeout: config.defaultTimeout});
        }catch(error){
            isVariant = false;
        }

        logger.info((isVariant ? "Produk memiliki varian" : "Produk tidak memiliki varian"));

        if(isVariant){
            try{
                await page.waitForSelector("#pdpVariantContainer > div > div:nth-child(2) > div > button", {timeout: config.defaultTimeout});
            }catch(error){
                variantType = 2;
            }

            switch(variantType){
                case 1:
                    logger.info(`Memilih varian`);
                    await page.click("#pdpVariantContainer > div > div:nth-child(2) > div > button");
                    await page.waitForTimeout(1000);
                    await page.waitForSelector("#pdpVariantContainer > div > div:nth-child(2) > div > div > ul > li:nth-child(1)", {timeout: config.defaultTimeout});
                    const varianList = await page.$("#pdpVariantContainer > div > div:nth-child(2) > div > div > ul");
                    let varianNum = await varianList.evaluate(el => el.childElementCount);
                    varianNum = Math.floor(Math.random() * (varianNum - 1) + 1);
                    await page.click(`#pdpVariantContainer > div > div:nth-child(2) > div > div > ul > li:nth-child(${varianNum})`);
                    const varian = await page.$(`#pdpVariantContainer > div > div:nth-child(2) > div > div > ul > li:nth-child(${varianNum})`);
                    const varianValue = await varian.evaluate(el => el.textContent);
                    logger.info(`Varian "${varianValue}" dipilih`);
                    break;
                case 2:
                    const varianList1 = await page.$("#pdpVariantContainer > div > div.css-xqma57");
                    let varianNum1 = await varianList1.evaluate(el => el.childElementCount);
                    varianNum1 = Math.floor(Math.random() * (varianNum1 - 1) + 1);
                    await page.click(`#pdpVariantContainer > div > div.css-xqma57 > button:nth-child(${varianNum1}) > div`);
                    const varian1 = await page.$(`#pdpVariantContainer > div > div.css-xqma57 > button:nth-child(${varianNum1}) > div > img`);
                    const varianValue1 = await varian1.evaluate(el => el.alt);
                    logger.info(`Varian "${varianValue1}" dipilih`);
                    break;
            }
            
            await page.waitForTimeout(1000);
            await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > button", {timeout: config.defaultTimeout});
            await page.click("#pdpFloatingActions > div.css-1gqhae2 > button");
            await page.waitForTimeout(1000);
            if(jumlahCustom){
                logger.info(`Mengatur jumlah menjadi ${input.jumlah}`);
                await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > input", {timeout: config.defaultTimeout});
                await page.click("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > input");
                await page.keyboard.down("ControlLeft");
                await page.keyboard.press("a");
                await page.keyboard.up("ControlLeft");
                await page.keyboard.press("Backspace");
                await page.type("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > input", input.jumlah);
            }
            let xpath1 = await page.$x("/html/body/div[1]/div/div[2]/div[2]/div[3]/div/div[1]/div[2]/div/div[3]/a");
            xpath1[0].click();
            await page.waitForTimeout(1000);
            logger.info(`Mengisi note dengan "${note}"`);
            await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > input");
            await page.type("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > input", note);
        }else{
            if(jumlahCustom){
                logger.info(`Mengatur jumlah menjadi ${input.jumlah}`);
                await page.waitForSelector("#pdpFloatingActions > div.css-qfdk7t > div > input", {timeout: config.defaultTimeout});
                await page.click("#pdpFloatingActions > div.css-qfdk7t > div > input");
                await page.keyboard.down("ControlLeft");
                await page.keyboard.press("a");
                await page.keyboard.up("ControlLeft");
                await page.keyboard.press("Backspace");
                await page.type("#pdpFloatingActions > div.css-qfdk7t > div > input", input.jumlah);
            }
            logger.info(`Mengisi note dengan "${note}"`);
            await page.waitForSelector("#pdpFloatingActions > div.css-1qxp37q > a", {timeout: config.defaultTimeout});
            await page.click("#pdpFloatingActions > div.css-1qxp37q > a");
            await page.waitForTimeout(1000);
            await page.waitForSelector("#pdpFloatingActions > div.css-1qxp37q > input");
            await page.type("#pdpFloatingActions > div.css-1qxp37q > input", note);
        }

        logger.info("Selesai");
        browserList.delete(id);
        id--;
        await page.waitForTimeout(1000);
        await page.waitForSelector("#pdpFloatingActions > div.css-qiunk2 > div.css-c1hnei > button.css-ra3v66-unf-btn.eg8apji0");
        await page.click("#pdpFloatingActions > div.css-qiunk2 > div.css-c1hnei > button.css-ra3v66-unf-btn.eg8apji0");
        await page.waitForTimeout(2000);
        await browser.close();    
    }catch(error){
        logger.error(error);
        browser.close();
        logger.info("Mengalami kegagalan, menjalankan ulang!");
        openBrowser(input, id);
    }
}