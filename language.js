const translations = {
  en: {
signIn: "Sign In",
profile: "My Profile",
myOrders: "My Orders",
waitingTime: "Waiting Time",
customerSupport: "Customer Support",
checkout: "Checkout",
logout: "Logout",
heroTitle: "Accessories For Everyone",
heroDescription: "Discover trendy accessories, keychains, phone accessories, wallets, jewelry and more — all in one place.",
searchPlaceholder: "Search products",
new: "New",
keychains: "Keychains",
phone: "Phone",
wallets: "Wallets",
jewelry: "Jewelry",
bags: "Bags",
more: "More",
newArrivals: "New Arrivals",
seeAll: "See All",
shopLatestTitle: "Shop The Latest Collection",
shopLatestDesc: "Premium quality accessories with affordable prices.",
shopNow: "Shop Now",
footerTagline: "Accessories • Quality • Style",
developer: "Developer and Founder: Rudox",
creativeLead: "Creative lead and Co-founder: Valrqx",
  },

  mm: {
    signIn: "အကောင့်ဝင်ရန်",
profile: "ကျွန်ုပ်၏ ပရိုဖိုင်",
myOrders: "ကျွန်ုပ်၏အော်ဒါများ",
waitingTime: "စောင့်ဆိုင်းချိန်",
customerSupport: "ဆက်သွယ်ရန်",
checkout: "ငွေချေမည်",
logout: "အကောင့်ထွက်ရန်",
heroTitle: "လူတိုင်းအတွက် အသုံးအဆောင်ပစ္စည်းများ",
heroDescription: "ခေတ်မီအသုံးအဆောင်ပစ္စည်းများ၊ သော့ချိတ်များ၊ ဖုန်းအသုံးအဆောင်ပစ္စည်းများ၊ ပိုက်ဆံအိတ်များ၊ လက်ဝတ်ရတနာများနှင့် အခြားပစ္စည်းများကို တစ်နေရာတည်းတွင် ရှာဖွေဝယ်ယူနိုင်ပါသည်။",
searchPlaceholder: "ပစ္စည်းရှာရန်",
new: "အသစ်များ",
keychains: "သော့ချိတ်များ",
phone: "ဖုန်းအသုံးအဆောင်များ",
wallets: "ပိုက်ဆံအိတ်များ",
jewelry: "လက်ဝတ်ရတနာများ",
bags: "အိတ်များ",
more: "ပိုမိုကြည့်ရန်",
newArrivals: "အသစ်ရောက်ပစ္စည်းများ",
seeAll: "အားလုံးကြည့်ရန်",
shopLatestTitle: "နောက်ဆုံးထွက်ပစ္စည်းများကို ဝယ်ယူလိုက်ပါ",
shopLatestDesc: "အရည်အသွေးမြင့် အသုံးအဆောင်ပစ္စည်းများကို သင့်တင့်သောဈေးနှုန်းဖြင့် ရရှိနိုင်ပါသည်။",
shopNow: "ယခုဝယ်ယူရန်",
footerTagline: "အသုံးအဆောင် • အရည်အသွေး • စတိုင်",
developer: "တည်ထောင်သူနှင့် ဝဘ်ဆိုက်ဖန်တီးသူ: Rudox",
creativeLead: "ဖန်တီးမှုဦးဆောင်သူနှင့် ပူးတွဲတည်ထောင်သူ: Valrqx",
  }
};

function changeLanguage(lang) {
  localStorage.setItem("language", lang);

  document.querySelectorAll("[data-lang]").forEach(element => {
    const key = element.dataset.lang;

    if (translations[lang]?.[key]) {
      element.textContent = translations[lang][key];
    }
  });

  document.querySelectorAll("[data-lang-placeholder]").forEach(element => {
    const key = element.dataset.langPlaceholder;

    if (translations[lang]?.[key]) {
      element.placeholder = translations[lang][key];
    }
  });
}