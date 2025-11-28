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

interface UnlockBookDetailV2 {
  chapterList: UnlockChapterItem[];
  bookName: string;
  bookCover: string;
  introduction: string;
}

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7",
  "android-id": "ffffffff94d1fe9a000000000",
  apn: "1",
  brand: "Xiaomi",
  cid: "DAUAF1064291",
  "content-length": "291",
  "content-type": "application/json; charset=UTF-8",
  "current-language": "in",
  "device-id": "04999725-0a8d-4199-92a3-294593f999b2",
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
  tn: "Bearer ZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKSVV6STFOaUo5LmV5SnlaV2RwYzNSbGNsUjVjR1VpT2lKVVJVMVFJaXdpZFhObGNrbGtJam96TkRrM01EWTFPREY5LnBjUGk2WXF0Tkp2UnJmOWQ1SVJUdGZKX2NEMEhkRXd3X1kxNFlRVGdNOUU=",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  "user-id": "349706581",
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

  async searchBook(
    keyword: string,
    pageNo: number = 1,
    pageSize: number = 100
  ) {
    const payload = {
      searchSource: "搜索按钮",
      pageNo,
      pageSize,
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
    if (!response.data.searchList) {
      return {
        ...response.data,
        searchList: [],
        isMore: 0,
      };
    }
    const validBookList = response.data.searchList.filter(
      (book: any) => !!book.bookId
    );
    return {
      ...response.data,
      searchList: validBookList,
    };
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

  /**
   *
   * @deprecated Use loadBook instead
   * @param bookId
   * @param chapterIdList
   * @returns
   */
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

  async loadBook(bookId: string) {
    const payload = {
      bookId: bookId,
      boundaryIndex: 0,
      comingPlaySectionId: -1,
      currencyPlaySource: "continueWatchingBar",
      currencyPlaySourceName: "继续观看提示条",
      enterReaderChapterIndex: 19,
      index: 20,
      loadDirection: 1,
      needEndRecommend: 0,
      preLoad: true,
      pullCid: "",
      rid: "",
      startUpKey: "",
    };
    this.timestamp = Date.now();
    const signature = await this.getSignature(payload);
    const res = await fetch(
      `https://dramabox-api.d5studio.site/proxy.php/drama-box/chapterv2/batch/load?timestamp=${this.timestamp}`,
      {
        method: "POST",
        headers: { ...this.headers, sn: signature },
        body: JSON.stringify(payload),
      }
    );
    const response = (await res.json()) as BaseResponse<UnlockBookDetailV2>;
    if (!response.success) throw new Error(response.message);
    return response.data;
  }

  async crawlAllBooks() {
    const queries = [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
      "m",
      "n",
      "o",
      "p",
      "q",
      "r",
      "s",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
    ];
    const seen = new Set<string>();
    const books: Book[] = [];
    for (const query of queries) {
      let pageNo = 1;
      for (;;) {
        const result = await this.searchBook(query, pageNo);

        for (let i = 0; i < result.searchList.length; i++) {
          const book = result.searchList[i];
          if (!seen.has(book.bookId)) {
            seen.add(book.bookId);
            books.push(book);
          }
        }
        if (result.isMore !== 1) break;
        pageNo++;
      }
    }
    return books;
  }
}
