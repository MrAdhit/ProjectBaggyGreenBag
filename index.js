const puppeteer = require("puppeteer-extra");
const fs = require("fs");
const EventEmitter = require("events");
const fss = fs.promises;
const csv = require("csv-parser");
const log4js = require("log4js");
const term = require("terminal-kit").terminal;
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const config = require("./config.json");
const date = new Date().toISOString().replace(/:/g, "-");
let id = 0;

term.on("key", (name, matches, data) => {
    if(name == "CTRL_C"){
        terminate();
    }
})

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
puppeteer.use(StealthPlugin());

let browserList = new Map();

(async () => {
    let dataRes = [];
    term.fullscreen();
    term("Pilih Mode:");
    term.singleColumnMenu(["Add To Cart (Auto)", "Add To Cart (Manual)", "Clear Cart", "Cancel"], async (err, resp) => {
        if([0, 1, 2].includes(resp.selectedIndex)){
            term.clear();
            let chooseFile = async () => {
                let files = await fss.readdir("./");
                files = files.filter((val) => {
                    if(val.includes(".csv")){
                        return fs.readFileSync(val).includes("akun");
                    }
                });
                term.bold("Pilih file CSV data: ");
                term.inputField({autoComplete: files, autoCompleteHint: true, autoCompleteMenu: true}, async (err, res) => {
                    if(!fs.existsSync(res)){
                        term.clear();
                        term.bold.red(`Tidak bisa menemukan file "${res}"\n`)
                        chooseFile();
                        return;
                    }

                    term.clear();

                    if(resp.selectedIndex == 2){
                        term.bold.red(centerize("[Mode Clear Cart]", "="));
                        fs.createReadStream(res)
                            .pipe(csv())
                            .on("data", (data) => dataRes.push(data))
                            .on("end" , () => {
                                dataRes.forEach(async(data, index) => {
                                    await delay(1000 * index);
                                    runThis(data, false, true);
                                });
                            });
                        return;
                    }

                    (resp.selectedIndex == 0 ? term.bold.cyan(centerize("[Mode Otomatis]", "=")) : term.bold.green(centerize("[Mode Manual]", "=")));
                    fs.createReadStream(res)
                        .pipe(csv())
                        .on("data", (data) => dataRes.push(data))
                        .on("end" , () => {
                            dataRes.forEach(async(data, index) => {
                                await delay(1000 * index);
                                runThis(data, (resp.selectedIndex == 0 ? false : true), false);
                            });
                        });
                });
            }
            chooseFile();
        }

        if(resp.selectedIndex == 3){
            terminate();
        }
    });
})();

function terminate(){
    term.clear();
    process.exit();
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function centerize(str, filler = " "){
    return repeatStr(filler, Math.floor((process.stdout.columns - str.length) / 2)) + str + repeatStr(filler, Math.floor((process.stdout.columns - str.length) / 2)) + "\n";
}

function repeatStr(char, count){
    let arr = [];
    for (let i = 0; i < count; i++) {
        arr.push(char);
    }
    return arr.join("");
}

function runThis(data, manual = false, clearcart){
    if(browserList.size > config.maxBrowser){
        setTimeout(() => {
            runThis(data, manual, clearcart);
        }, 1000);
        return;
    }
    id++;
    browserList.set(`browser${id}`, true);
    openBrowser(data, `browser${id}`, manual, clearcart);
}

async function openBrowser(input, id, manual, clearcart){
    const logger = log4js.getLogger(id);
    logger.addContext("browserID", date);

    logger.info(`Membuka Browser`);
    const browser = await puppeteer.launch({headless: false, ignoreDefaultArgs: ["--enable-automation", "--enable-blink-features=IdleDetection"], args: ["--window-size=800,800", "--no-sandbox"], defaultViewport: null});
    browserList.set(id, true);
    try{
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            const url = request.url();

            const filters = [
              "btstatic",
              "googleadservices",
              "doubleclick",
              "idsync",
              "quant",
              "facebook",
              "amazon",
              "tracking",
              "taboola",
              ".gif",
              "google-analytics",
              "forter",
              "event",
              "analytics",
              "client-log",
              "images"
            ];

            const whitelist = [
                "tokopedia.com",
                "tokopedia.net"
            ]
      
            const shouldAbort = whitelist.some(
              (urlPart) => url.includes(urlPart)
            );
            const shouldAbort2 = filters.some(
                (urlPart) => url.includes(urlPart)
            )

            if (!shouldAbort) request.abort();
            else if (shouldAbort2) request.abort();
            else {
              request.continue();
            }
          });

        logger.info(`Mengatur Cookies`);
        let cookies = await fss.readFile(input.akun).catch((err) => {
            logger.error(`Tidak bisa menemukan file "${input.akun}"`);
            browser.close();
            return;
        });

        try{
            cookies = JSON.parse(cookies);
        }catch(error){
            browser.close();
            return;
        }
        await page.setCookie(...cookies.cookies);

        if(clearcart){
            logger.info(`Menuju halaman cart`);
            await page.goto("https://www.tokopedia.com/cart", {timeout: 0});

            try{
                await page.$eval("body > h1", (el) => el.textContent);
                await page.reload();
                await page.waitForTimeout(config.delay);
            }catch(error){
                
            }

            let emptyCart = true;

            try{
                await page.waitForSelector("#opening-content-area > div > h2", {timeout: 5000});
            }catch(err){
                emptyCart = false;
            }
            await page.waitForTimeout(config.delay);
            (emptyCart ? logger.info(`Cart sudah kosong`) : "");
            if(!emptyCart){
                await page.waitForTimeout(config.delay);
                await page.waitForSelector("#check-all-items");
                let checked = await page.$eval("#check-all-items", (el) => el.checked);
                logger.info(`Menghapus semua barang dari cart`);
                (checked ? "" : await page.click("#cart-sticky-sellect-all > div.css-loqb2 > div.wrapper__left > label"));
                await page.waitForTimeout(config.delay);
                await page.click("#cart-sticky-sellect-all > div.css-loqb2 > div.wrapper__right > p.wrapper__button.css-1sa24v9-unf-heading.e1qvo2ff8");
                await page.waitForTimeout(config.delay);
                await page.waitForSelector("aria/Hapus Barang","aria/[role=\"generic\"]");
                await page.click("aria/Hapus Barang","aria/[role=\"generic\"]");

                await page.waitForSelector("body > div:nth-child(32) > div > p");
                let info = await page.$eval("body > div:nth-child(32) > div > p", (el) => el.textContent);
                await page.waitForTimeout(config.delay);
                logger.info(info);
            }

            browserList.delete(id);
            await browser.close();
            setTimeout(() => {
                if(browserList.size == 0){
                    terminate();
                }
            }, 1000);

            return;
        }

        logger.info(`Menuju "${input.produk}"`);
        await page.goto(input.produk, {timeout: 0});

        logger.info(`Sukses menuju "${input.produk}"`);

        let isVariant = true;
        let stockAvailable = false;
        let variantType = 1;
        let note = (typeof(input.note) == "undefined" | input.note == "" ? config.note : input.note);
        let jumlahCustom = (typeof(input.jumlah) == "undefined" | input.jumlah <= 1 | input.jumlah == "" ? false : true);

        try{
            await page.$eval("body > h1", (el) => el.textContent);
            await page.reload();
            await page.waitForTimeout(config.delay);
        }catch(error){
            
        }

        if(manual){
            browser.on("disconnected", async() => {
                logger.info("Browser Ditutup");
                browserList.delete(id);
                await browser.close();
                setTimeout(() => {
                    if(browserList.size == 0){
                        terminate();
                    }
                }, 1000);
            });
            return;
        }

        try{
            logger.info(`Mengecek jenis varian`);
            await page.waitForSelector("#pdpVariantContainer > div", {timeout: config.defaultTimeout});
        }catch(error){
            isVariant = false;
        }

        try{
            logger.info(`Mengecek stock`);
            await page.waitForSelector("#unf-ticker__active-item > div:nth-child(2) > p.css-1ih5x8y-unf-heading.e1qvo2ff8", {timeout: config.defaultTimeout});
        }catch(error){
            stockAvailable = true;
        }

        logger.info((isVariant ? "Produk memiliki varian" : "Produk tidak memiliki varian"));

        if(!stockAvailable){
            logger.warn(`Stock produk telah habis`);
            logger.warn(`Menutup browser`);
            browserList.delete(id);
            browser.close();
            return;
        }

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
                    await page.waitForTimeout(config.delay);
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
            
            await page.waitForTimeout(config.delay);
            await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > button", {timeout: config.defaultTimeout});
            await page.click("#pdpFloatingActions > div.css-1gqhae2 > button");
            await page.waitForTimeout(config.delay);
            if(jumlahCustom){
                let stock = await page.$("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > p > b");
                stock = await stock.evaluate(el => el.textContent);
                stock = parseInt(stock.replace().replace(/\D/g, ""));
                logger.info(`Jumlah stock produk ${stock}`);
                await page.waitForTimeout(config.delay);
                if(parseInt(input.jumlah) > stock) {
                    logger.warn(`Jumlah stock lebih sedikit daripada jumlah yang akan dibeli`);
                    input.jumlah = stock;
                    logger.warn(`Mengubah jumlah yang akan dibeli menjadi ${stock}`);
                }
                await page.waitForTimeout(config.delay);
                logger.info(`Mengatur jumlah menjadi ${input.jumlah}`);
                await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > input", {timeout: config.defaultTimeout});
                await page.click("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > input");
                await page.waitForTimeout(config.delay);
                for (let index = 1; index < input.jumlah; index++) {
                    await page.click("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-qfdk7t > div > button:nth-child(3)");
                }
            }
            await page.waitForTimeout(config.delay);
            await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > a > b", {timeout: config.defaultTimeout});
            await page.click("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > a > b");
            await page.waitForTimeout(config.delay);
            logger.info(`Mengisi note dengan "${note}"`);
            await page.waitForSelector("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > input");
            await page.type("#pdpFloatingActions > div.css-1gqhae2 > div > div.css-1qxp37q > input", note);
        }else{
            if(jumlahCustom){
                let stock = await page.$("#pdpFloatingActions > div.css-qfdk7t > p > b");
                stock = await stock.evaluate(el => el.textContent);
                stock = parseInt(stock.replace().replace(/\D/g, ""));
                logger.info(`Jumlah stock produk ${stock}`);
                if(parseInt(input.jumlah) > stock) {
                    logger.warn(`Jumlah stock lebih sedikit daripada jumlah yang akan dibeli`);
                    input.jumlah = stock;
                    logger.warn(`Mengubah jumlah yang akan dibeli menjadi ${stock}`);
                }
                await page.waitForTimeout(config.delay);
                logger.info(`Mengatur jumlah menjadi ${input.jumlah}`);
                await page.waitForSelector("#pdpFloatingActions > div.css-qfdk7t > div > input", {timeout: config.defaultTimeout});
                await page.click("#pdpFloatingActions > div.css-qfdk7t > div > input");
                await page.waitForTimeout(config.delay);
                for (let index = 1; index < input.jumlah; index++) {
                    await page.click("#pdpFloatingActions > div.css-qfdk7t > div > button:nth-child(3)");
                }
            }
            await page.waitForSelector("#pdpFloatingActions > div.css-1qxp37q > a", {timeout: config.defaultTimeout});
            await page.click("#pdpFloatingActions > div.css-1qxp37q > a");
            await page.waitForTimeout(config.delay);
            logger.info(`Mengisi note dengan "${note}"`);
            await page.waitForSelector("#pdpFloatingActions > div.css-1qxp37q > input");
            await page.type("#pdpFloatingActions > div.css-1qxp37q > input", note);
        }
        
        let isSuccess = false;
        let tryAtc = 0;

        while(!isSuccess){
            logger.info(`Mencoba Add to cart (${tryAtc})`);
            await page.waitForTimeout(config.delay);
            await page.waitForSelector("#pdpFloatingActions > div.css-qiunk2 > div.css-c1hnei > button.css-ra3v66-unf-btn.eg8apji0");
            await page.click("#pdpFloatingActions > div.css-qiunk2 > div.css-c1hnei > button.css-ra3v66-unf-btn.eg8apji0");
            let v1 = false;
            try{
                await page.waitForSelector(".css-jtcihq-unf-heading", {timeout: config.defaultTimeout});
                let errorMsg = await page.$(".css-jtcihq-unf-heading");
                errorMsg = await errorMsg.evaluate(el => el.textContent);
                logger.error(errorMsg);
                if(errorMsg == "Maaf, terjadi sedikit kendala. Coba ulangi beberapa saat lagi ya."){
                    if(tryAtc >= 3){
                        logger.warn("Kegagalan sudah mencapai batas, menjalankan ulang!");
                        openBrowser(input, id, manual, clearcart);
                        browser.close();
                    }
                    v1 = true;
                    tryAtc++;
                    await page.waitForTimeout(10000);
                }
            }catch(error){
                
            }
            isSuccess = !v1;
        }
        // (!fs.existsSync("./ssLogs") ? fs.mkdirSync("./ssLogs") : "");
        await page.waitForTimeout(config.delay);
        // await page.screenshot({path: `./ssLogs/${date}-${id}.png`});
        setTimeout(() => {
            if(browserList.size == 0){
                terminate();
            }
        }, 1000);
        logger.info("Selesai");
        browserList.delete(id);
        await browser.close();
    }catch(error){
        logger.error(error);
        browser.close();
        logger.warn("Mengalami kegagalan, menjalankan ulang!");
        openBrowser(input, id, manual, clearcart);
    }
}