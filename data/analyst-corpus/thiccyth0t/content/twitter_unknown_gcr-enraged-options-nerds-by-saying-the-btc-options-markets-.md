---
source: twitter
author: thiccyth0t
date: unknown
url: https://x.com/thiccythot_/status/1625088347134623744
title: "Volatility and options framework"
type: thread
tweet_count: 33
---

### Tweet 1/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088347134623744)

GCR 😡 enraged options nerds by saying the $BTC options markets were mispriced 🙅 GCR forecasts >14% chance we retest $BTC's 15k lows in 2023, making a $BTC put option purchase look juicy Why were the geeks mad? Is GCR right? How should you interpret options market data? 1/🧵 https://twitter.com/GCRClassic/status/1624832001428578304

---

### Tweet 2/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088348787249155)

Having worked on a 🔮DeFi options protocol with @alexwlezien for over a year, I know options pricing + volatility well enough to understand things but I am normie enough to be able to explain it in a way that the 👱🧑‍🦰 average person can digest (hopefully) Let's dive in 👇 2/

---

### Tweet 3/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088350137843714)

Gonna start with some basics so we're all on the same page. Vol experts 🦈 can skip the next few tweets! An option is a financial derivative that gives you the right but not the obligation to buy or sell an asset at a predetermined strike price 3/

---

### Tweet 4/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088351719006209)

This allows a trader not just to bet on the Expected Value (EV) of an asset, but also the shape and speed of an asset's underlying price action People can use options to: - transfer risk (hedge) 💱 - acquire leverage with capped downside 🦧 - generate yield 💸 4/

---

### Tweet 5/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088354202025985)

Traditional options pricing uses the Black-Scholes model, which assumes prices are random walks that follow Brownian Motion (GBM). The logarithm of the asset's returns are normally distributed This distribution captures the fact that assets prices cannot go below 0 5/

---

### Tweet 6/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088355682639873)

Options are typically quoted in "IV", or the implied volatility The IV inputs in the market price of the option and outputs the annualized standard deviation of the price return distribution required for the asset to move to the option's strike price by the expiry 6/

---

### Tweet 7/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088357070954496)

@GCRClassic 's screenshot is the $BTC options chain on @DeribitExchange , the most liquid crypto options exchange: deribit.com/options/BTC/BT… These are 🇪🇺 European options 🇪🇺 GCR was looking at $BTC put options expiring 29-DEC-2023 at a $15,000 strike for ~$1250 7/

---

### Tweet 8/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088358555828225)

In GCR's picture, the $15,000 BTC put option is being quoted at a 58.98% IV This means that if you wanted to purchase this option for ~$1250, that would mean that you think that $BTC could reasonably move (+- 1 std) MORE than 58.98% in a year 8/

---

### Tweet 9/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088360690733059)

The delta is how much $ the option prices moves if the price of the asset goes up 1$ using the Black-Scholes equation The delta of GCR's option is -0.14. This means: put price -$0.14 if $BTC +$1 put price +$0.14 if $BTC -$1 9/

---

### Tweet 10/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088362209058820)

The delta is commonly viewed as the probability that the option will settle in-the-money (insert foreshadowing) We're done with the basics! Now onto the 🌶️ spicy stuff 🌶️ 10/

---

### Tweet 11/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088363639320576)

GCR originally tweeted that the options market was mispriced because the delta on the option was 14% he viewed a >14% chance that $BTC price retests its $15k lows before the end of 2023 Seems pretty reasonable right at first glance? 11/

---

### Tweet 12/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088365119913985)

Well here's what the options nerds were raging 😡 about: 1. Retesting 15k is different than settling at <15k 2. Options Delta doesn't always equal probability of settling in the money 12/

---

### Tweet 13/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088366373920769)

🇪🇺 Euro options settle at the price at expiry. The difference between strike and settle price (if any) is transferred from the option seller (virgin mms) to the option buyer (chad GCR) $BTC retesting $15k by year end is NOT what buying a Euro put is necessarily betting on 13/

---

### Tweet 14/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088367720292353)

Under Black-Scholes assumptions, there are many hypothetical price paths where $BTC retests $15k and then bounces back above $15k for the Dec settle We can simulate these price paths using a Monte Carlo experiment, which is just a fancy way of fucking around and finding out 14/

---

### Tweet 15/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088369154744320)

After 10 million simulations (rip macbook), over 40% of the times $BTC retested $15k, it actually bounced back and settled above $15k In other words, an options delta of 0.14 DOES NOT imply that the options market thinks that there is a 14% chance $BTC retests the strike 15/

---

### Tweet 16/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088370606047232)

So 0.14 delta doesn't mean 14% chance we retest the strike but does it mean 14% chance we SETTLE under the strike? Options deltas approximate the probability of settling in-the-money closely under CERTAIN conditions, but not all. 16/

---

### Tweet 17/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088371872653312)

When the implied volatility is high and the time to expiry is long, this rule of thumb can be wildly off In GCR's option, the delta is 0.1454 but the probability of settling ITM is actually 0.30, or OVER 30% 🤯 17/

---

### Tweet 18/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088373260972036)

Why? When the implied volatility is high and the time to expiry is long, the approximation of delta and % itm breaks down only if sigma * sqrt(T) is small does delta = probability of itm 18/

---

### Tweet 19/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088374791892993)

What's the intuition? 1) we assume that asset prices are fairly priced and EV 0 given the underlying price distribution (otherwise stop trading options and just go buy spot bro) 19/

---

### Tweet 20/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088376830324736)

2) we assume participants are risk neutral, meaning that a 1% chance $BTC goes to $100k adds $1k in EV to $BTC's fair value. There is no discount for low probability or high probability outcomes 20/

---

### Tweet 21/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088377870483458)

3) price asymmetry means asset prices can go to infinity but cannot go below 0. This drastically effects the EV calculation of the price distribution as especially implied volatility increases and time to expiry increases 21/

---

### Tweet 22/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088378885505026)

There might be a 1% chance $BTC goes $100k, but the chance that $BTC goes to -$80k is 0% To balance out the asymmetry, the $BTC number of paths that lead to lower $BTC has to be greater than the number of paths that lead to higher $BTC for the spot price to be EV 0 22/

---

### Tweet 23/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088379879563266)

Delta incorporates not just the probability of an option being itm but the amount the option is in the money, favoring infinity-chad calls over virgin-capped downside puts Delta < ITM % for puts Delta > ITM % for calls 23/

---

### Tweet 24/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088380965986304)

We can observe the effect that time to expiry has on the delta vs. ITM prob% with this handsome graph below. At 500 days to expiry, the difference can be over 25% This is because more time gives $BTC more likelihood to run to infinity 24/

---

### Tweet 25/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088382836568070)

This effect scales with implied volatility as well, as a higher implied volatility also gives $BTC more legs to scale to infinity pretty fuckin sick ey? 25/

---

### Tweet 26/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088605654859776)

With BTC at 21,750 strike at 15,000 implied volatility of ~59% Probability $BTC closes < $15k by eoy: ~30% Probability $BTC retests $15k by eoy: ~55% Much different than the initial 14%! 26/

---

### Tweet 27/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625088874673238016)

Brief aside on some background on GCR for those who don’t know, he is the GOAT binary options trader and one of our generation’s greatest forecasters He picked off Do Kwon for $10M in the greatest trade of 2022 exploiting the very same option price asymmetry that we described… twitter.com/i/web/status/1…

---

### Tweet 28/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625089061428789248)

The 10 million dollar question to @GCRClassic for 2023 is: Do you think that the 55% chance implied by options markets of a 15k retest by eoy is fair or is that also underpriced? 🤔🤔🤔 28/

---

### Tweet 29/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625089333576323072)

@GCRClassic if you made it this far, thanks for your attention. Would like to thank my fabulous partner @alexwlezien for getting baked with me and pontificating about options theory. 29/

---

### Tweet 30/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625089798191951872)

Huge shoutout to @0xDrizzleSizzle for his help with the simulations and the math. The man's got some vol chops and just a nice guy 30/

---

### Tweet 31/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625090618404876292)

Tagging some volatility professions who know much more than me to make sure I didn't mess up anywhere. You should probably give them a follow as well! @0xDrizzleSizzle @rush_btc @joshua_j_lim @roshunpatel @SinclairEuan @ArturSepp @bennpeifert 31/

---

### Tweet 32/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625101790386552838)

Wanted to add a caveat that real world price movements frequently violate black scholes assumptions, and that it is far from a perfect model. It allow us to normalize price distributions in a way that is easy to digest, communicate, and trade! 32/

---

### Tweet 33/33
**@thiccyth0t** | [link](https://x.com/thiccyth0t/status/1625111544316014593)

Forgot one @DanielGeisinger

---
