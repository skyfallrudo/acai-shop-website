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
}

document.addEventListener("DOMContentLoaded", () => {
  const language = localStorage.getItem("language") || "en";
  changeLanguage(language);
});