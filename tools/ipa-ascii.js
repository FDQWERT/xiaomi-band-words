/*
 * 音标 ASCII 化。
 *
 * 手环上的 Vela 运行时用的是系统自带的精简字体，只有拉丁字母这一块字形，
 * 国际音标扩展区（ʃ θ ð ŋ ɪ ə ː ˈ ˌ …）里有一部分字没有字形，真机上会显示成
 * 空白或者方框。字体改不了（快应用不能内嵌字体），所以把音标换成只用 ASCII
 * 的近似记法：
 *
 *   ʃ → sh   ʒ → zh   θ → th   ð → dh   ŋ → ng
 *   tʃ → ch  dʒ → j   eɪ → ei  aɪ → ai  aʊ → au  əʊ → ou
 *   æ → a    ʌ → u    ɒ → o    ɔ → o    ə → e   ɜ → e   ɪ → i   ʊ → u
 *   ː → :    ˈ → '    ˌ → ,
 *
 * 这样 /ˈæpl/ 变成 /'apl/，/ˈtiːtʃə(r)/ 变成 /'ti:che(r)/，全部都是拉丁字母、
 * 数字和标点，任何字体都画得出来，读音也还看得懂。
 */
const FIX = {
  // 源词表里这几条的音标列混进了单词拼写（词典的分音节写法），手工改成真音标
  "`erə,pleɪn": "ˈeərəpleɪn",
  "`ænl,aɪz": "ˈænəlaɪz",
  "`bɔl,pɔɪnt": "ˈbɔːlpɔɪnt",
  "`bɑrbər,ʃɑp": "ˈbɑːbəʃɒp",
  "bɪ`heɪvjər": "bɪˈheɪvjə",
  "`bʊk,ʃelf": "ˈbʊkʃelf",
  "`bɔrɪŋ": "ˈbɔːrɪŋ",
  "exˈact·ly": "ɪgˈzæktlɪ",
  "of·fence || əˈfens": "əˈfens",
  "seɪlz‚wʊmən": "ˈseɪlzwʊmən",
  "‚saʊθˈɪːs": "ˌsaʊθˈiːst",
  "‚tiːˈviː": "ˌtiːˈviː",
  "ˈtwentɪ- [fɜːst": "ˈtwentɪfɜːst",
  "ˈweath·er·man": "ˈweðəmæn",
  "ˈwind,breikә": "ˈwɪndbreɪkə",
};

const PAIRS = [
  ["tʃ", "ch"], ["dʒ", "j"], ["ʤ", "j"], ["ʧ", "ch"],
  ["eɪ", "ei"], ["aɪ", "ai"], ["ɔɪ", "oi"], ["aʊ", "au"], ["əʊ", "ou"], ["oʊ", "ou"],
  ["ɪə", "ie"], ["eə", "ea"], ["ɛə", "ea"], ["ʊə", "ue"], ["iə", "ie"], ["uə", "ue"],
  ["ɜː", "e:"], ["əː", "e:"], ["ɛː", "e:"], ["eː", "e:"],
  ["iː", "i:"], ["ɑː", "a:"], ["ɔː", "o:"], ["uː", "u:"], ["aː", "a:"],
  ["θ", "th"], ["ð", "dh"], ["ʃ", "sh"], ["ʒ", "zh"], ["ŋ", "ng"],
  ["ɹ", "r"], ["ɾ", "r"], ["ɡ", "g"], ["ɣ", "g"], ["ʔ", "'"],
  ["æ", "a"], ["ʌ", "u"], ["ɑ", "a"], ["ɒ", "o"], ["ɔ", "o"], ["ə", "e"],
  ["ɜ", "e"], ["ɛ", "e"], ["ɪ", "i"], ["ʊ", "u"], ["ɐ", "a"], ["ә", "e"],
  ["ɚ", "er"], ["ɝ", "er"], ["ᵻ", "i"],
  ["ː", ":"], ["ˈ", "'"], ["ˌ", ","], ["ˑ", "."],
  ["̃", ""], ["̩", ""], ["˞", "r"], ["̯", ""],
  ["`", "'"], ["‚", ","], ["·", ""], ["|", ";"], ["[", ""], ["]", ""],
];

const SORTED = PAIRS.slice().sort((a, b) => b[0].length - a[0].length);

function toAscii(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (FIX[s] !== undefined) s = FIX[s];

  let out = "";
  let i = 0;
  while (i < s.length) {
    let hit = null;
    for (let k = 0; k < SORTED.length; k++) {
      const pair = SORTED[k];
      if (s.startsWith(pair[0], i)) {
        hit = pair;
        break;
      }
    }
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      const ch = s.charAt(i);
      out += ch >= " " && ch <= "~" ? ch : "";
      i += 1;
    }
  }

  out = out.replace(/::+/g, ":");
  out = out.replace(/\s*,\s*/g, ", ");
  out = out.replace(/\s*;\s*/g, "; ");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/^[\s,;.\-]+/, "");
  out = out.replace(/[\s,;]+$/, "");
  out = out.replace(/([,;])\s*([,;])/g, "$1");
  return out.trim();
}

function isAscii(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

module.exports = { toAscii, isAscii, FIX };
