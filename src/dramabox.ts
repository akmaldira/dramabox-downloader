interface BaseResponseSuccess<T> {
  status: 0;
  message: string;
  timestamp: number;
  success: true;
  data: T;
}

interface BaseResponseError {
  status: number;
  message: string;
  timestamp: number;
  success: false;
  data: null;
}

type BaseResponse<T> = BaseResponseSuccess<T> | BaseResponseError;

interface Book {
  bookId: string;
  bookName: string;
  cover: string;
  viewCount: number;
  followCount: number;
  introduction: string;
  chapterCount: number;
  labels: string[];
  tags: string[];
  typeTwoIds: number[];
  typeTwoNames: string[];
  typeTwoList: {
    id: number;
    name: string;
    replaceName: string;
  }[];
  language: string;
  typeTwoName: string;
  simpleLanguage: string;
  bookNameEn: string;
  bookNameLower: string;
  shelfTime: string;
  firstShelfTime: string;
}

interface ChapterItem {
  id: string;
  name: string;
  index: number;
  indexStr: string;
  unlock: boolean;
  mp4?: string;
  m3u8Url?: string;
  m3u8Flag?: boolean;
  cover: string;
  utime: string;
  chapterPrice: number;
  duration: number;
  new: boolean;
}

interface BookDetail {
  book: Book;
  recommends: Book[];
  chapterList: ChapterItem[];
  languages: string[];
  firstLanguage: string;
  articleList: any[];
  sourceBookId: string;
}

interface UnlockVideoPath {
  quality: number;
  videoPath: string;
  isDefault: number;
  isEntry: number;
  isVipEquity: number;
}

interface UnlockCdn {
  cdnDomain: string;
  isDefault: number;
  videoPathList: UnlockVideoPath[];
}

interface UnlockChapterItem {
  chapterId: string;
  chapterIndex: number;
  isCharge: number;
  chapterName: string;
  cdnList: UnlockCdn[];
  chapterImg: string;
  chapterType: number;
  needInterstitialAd: number;
  viewingDuration: number;
  chargeChapter: boolean;
}

interface UnlockBookDetail {
  chapterVoList: UnlockChapterItem[];
  bookName: string;
  bookCover: string;
  introduction: string;
}

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7",
  "android-id": "ffffffff9b5bfe16000000000",
  apn: "1",
  brand: "Xiaomi",
  cid: "DAUAF1064291",
  "content-length": "930",
  "content-type": "application/json; charset=UTF-8",
  "current-language": "in",
  "device-id": "ee9d23ac-0596-4f3e-8279-b652c9c2b7f0",
  language: "in",
  md: "Redmi Note 8",
  mf: "XIAOMI",
  origin: "https://dramabox.drama.web.id",
  ov: "9",
  "over-flow": "new-fly",
  p: "48",
  "package-name": "com.storymatrix.drama",
  priority: "u=1, i",
  referer: "https://dramabox.drama.web.id/",
  "time-zone": "+0700",
  tn: "Bearer ZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKSVV6STFOaUo5LmV5SnlaV2RwYzNSbGNsUjVjR1VpT2lKVVJVMVFJaXdpZFhObGNrbGtJam96TXpZd09EUXdOVFo5LkFLMWw0d01Ud00xVndOTHBOeUlOcmtHN3dmb0czaGROMEgxNWVPZV9KaHc=",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  "user-id": "336084056",
  version: "470",
  vn: "4.7.0",
};

export class DramaboxAPI {
  private headers: Record<string, string> = headers;
  private timestamp: number = Date.now();

  async getSignature(payload: any): Promise<string> {
    this.timestamp = Date.now();
    const deviceId = this.headers["device-id"];
    const androidId = this.headers["android-id"];
    const tn = this.headers["tn"];
    const strPayload = `timestamp=${this.timestamp}${JSON.stringify(
      payload
    )}${deviceId}${androidId}${tn}`;
    const signReqBody = { str: strPayload };

    const res = await fetch(`https://dramabox-api.d5studio.site/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        // the site used a Referer/origin -- optional from browser
        Origin: "https://dramabox.drama.web.id",
      },
      body: JSON.stringify(signReqBody),
    });

    if (!res.ok) throw new Error(`sign request failed: ${res.status}`);
    const response = (await res.json()) as {
      success: number;
      signature: string;
    };
    if (!response.success)
      throw new Error("sign endpoint returned success=false");
    return response.signature as string;
  }

  async searchBook(keyword: string) {
    const payload = {
      searchSource: "搜索按钮",
      pageNo: 1,
      pageSize: 100,
      from: "search_sug",
      keyword,
    };
    const signature = await this.getSignature(payload);
    const res = await fetch(
      `https://dramabox-api.d5studio.site/proxy.php/drama-box/search/search?timestamp=${this.timestamp}`,
      {
        method: "POST",
        headers: { ...this.headers, sn: signature },
        body: JSON.stringify(payload),
      }
    );

    const response = (await res.json()) as BaseResponse<any>;
    if (!response.success) throw new Error(response.message);
    return response.data;
  }

  async getBookDetail(id: string) {
    const res = await fetch(
      `https://www.webfic.com/webfic/book/detail/v2?id=${id}&tlanguage=in`,
      {
        method: "GET",
      }
    );

    const response = (await res.json()) as BaseResponse<BookDetail>;
    if (!response.success) throw new Error(response.message);
    return response.data;
  }

  async batchUnlockEpisode(bookId: string, chapterIdList: string[]) {
    const payload = {
      bookId: bookId,
      chapterIdList: chapterIdList,
    };

    this.timestamp = Date.now();
    const signature = await this.getSignature(payload);
    const res = await fetch(
      `https://dramabox-api.d5studio.site/proxy.php/drama-box/chapterv2/batchDownload?timestamp=${this.timestamp}`,
      {
        method: "POST",
        headers: { ...this.headers, sn: signature },
        body: JSON.stringify(payload),
      }
    );
    const response = (await res.json()) as BaseResponse<UnlockBookDetail>;
    if (!response.success) throw new Error(response.message);
    return response.data;
  }
}
