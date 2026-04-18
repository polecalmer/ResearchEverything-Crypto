---
source: substack
date: 2025-11-27
url: https://cryptohayes.substack.com/p/adapt-or-die
title: "Adapt or Die"
type: article
---

[![](https://substackcdn.com/image/fetch/$s_!2jsB!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc72fd663-e21a-4c8b-93cd-0fe7f5eb959e_400x560.jpeg)](https://substackcdn.com/image/fetch/$s_!2jsB!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc72fd663-e21a-4c8b-93cd-0fe7f5eb959e_400x560.jpeg)

_(Any views expressed here are the personal views of the author and should not form the basis for making investment decisions, nor be construed as a recommendation or advice to engage in investment transactions.)_

**Want More?** Follow the Author on **[Instagram](https://www.instagram.com/cryptohayes/)** , **[LinkedIn](https://www.linkedin.com/in/arthur-hayes-b493b42/)** and **[X](https://x.com/cryptohayes)**

Access the Korean language version here: **[Naver](https://blog.naver.com/maelstromkorea)**

Subscribe to see the latest Events: **[Calendar](https://lu.ma/mevents)**

 _Subscribe for new alerts_

Less than a decade ago, the elevated and distinguished TradFi scallywags heaped scorn and disdain ‌on the 100x leverage crypto derivatives market BitMEX created using this new derivatives contract called a perpetual swap. When I read missives from Jim Grant of Grant’s Interest Rate Observer and Dan Oliver of Myrmikan Capital highlighting the insanity that BitMEX offered such WMD’s for crypto, I smiled. But how things change. Suddenly TradExchanges, such as the **[SGX (Singapore)](https://www.sgx.com/derivatives/products/cryptoperps)** and **[CBOE (United States)](https://www.coindesk.com/markets/2025/11/17/cboe-to-debut-bitcoin-ether-perpetual-style-crypto-futures-on-dec-15)** will each launch perps or similar products by the end of 2025.[1] In the Pax Americana retail arena, the calls to bestow upon plebes and patricians alike the privilege of trading perps sans VPN resulted in Coinbase listing a bastardized version of the perp, similar to the CBOE’s version, earlier this year. Other intrepid entrepreneurs within the declining empire who wish to have a crack at chopping down the dominance of the CME will have their chance in a proposed CFTC-administered regulatory sandbox.[2] Supposedly after going after yours truly and others within the crypto derivatives space, the CFTC turned over a new leaf and is a friend of financial innovation once more.

What is it about the perp that created an “Adapt or Die” moment for TradFi? Why will derivatives trading volume across the world and across all financial assets migrate from dated futures and options contracts to never-expiring perps? To answer these questions, I will first provide a perp history lesson, which will explain why and how myself and BitMEX invented this new financial primitive. Then I will break down the fundamentals of perps and why they are a better derivative for an internet-connected world that operates 24/7, 365. Finally, I will provide my opinion on the likely trajectory of perp’s adoption outside of crypto and why TradExchanges will adapt their product offering to include perps and a socialized loss margin system or quickly die at the hands of both centralized (CEX) and decentralized (DEX) crypto exchanges.

Hyperliquid, the hottest new DEX on the block, launched a permissionless protocol, HIP-3, which allows a firm called XYZ to create a Nasdaq100 equity perp. The said contract now trades more than $100m per day and is one of the largest contracts by ADV listed on Hyperliquid.[3] Equity perps will become the hottest product of 2026, all DEXs and CEXs, like my beloved BitMEX, will offer them by the end of next year. This product will completely upend the equities derivatives trading market, which so far has beaten back the tides of progress regarding market access and competition from a diverse set of venues. If you invest in the tokens or equity of exchanges, it behooves you to understand everything there is to know about perps.

**Know Your History**

If you want to subjugate a foreign population, rob them of their history. Back in my younger days, my parents always supplemented the official narrative taught in school with other reading on a particular subject. Not that they had a prescriptive alternative version of known facts; rather, they encouraged me to question the official narrative and fed me books with different viewpoints. Obviously, most of this scholarship emanates from the lack of positive and truthful narratives surrounding “blackness” within the American experience. And my parents wouldn’t permit me to grow ignant as intended by the public and private school system.

In that light, I offer this firsthand account of the history of the perpetual swap.

There are a lot of folks who came out of the woodwork recently opining on the importance and genesis of the crypto perpetual swap, often referred to as “perps”. Given that they are telling my and BitMEX’s story, usually incorrectly, let’s get the record straight. As with everything in life, the BitMEX team relied on the prior art of others to create perps and its supporting margin system. I take offence to anyone who diminishes the accomplishments of my team by stating it’s just Robert Schiller’s design from the 1990s that was popularized by BitMEX and the crypto industry. Fuck You! That is bullshit. Read on to understand why.

Let’s travel back to May 2016, when BitMEX was a company of five folks. Ben Delo and Sam Reed were my other two co-founders, and our first two employees were Greg Dwyer (business development) and Jinming Shao (trading engine engineer). The crypto derivatives landscape was in some ways similar and ‌different from what it is today.

OKCoin (now OKX) and Huobi (now HTX) dominated the crypto derivatives market. Between them, they controlled ~95% of the market by ADV. BitMEX was a distant third, and frankly irrelevant. While we had the highest leverage (100x) of any exchange, our futures contracts’ liquidity paled compared to OKCoin and Huobi. The most liquid contract at the time was a Bitcoin-margined quarterly expiring futures contract.[4] At BitMEX, we tried many things to boost the liquidity on our contracts. Back then we had calendar spreads, daily, weekly, monthly, and quarterly futures contracts. In short, we spread liquidity out amongst our various XBT/USD futures contracts too thin.[5] We routinely asked ourselves, is there a way to create one product with no expiry so we can concentrate liquidity onto one contract?

We also asked ourselves how to simplify derivatives trading to better appeal to folks who graduated from margin trading. Margin trading is intuitive to understand because a trader just borrows money and trades on the spot order book. Understanding expiry dates and the price difference or basis between futures and spot is unnecessary for a trader to grasp when margin trading. But when these traders graduated to trading futures, they were confused. Because Ben, Sam, and I answered every customer support question ourselves, we always endeavored to lessen our daily load so we could get onto other work. A product that looked and felt like margin trading would remove the need to answer many questions from confused clients.

The first iteration of the perp grew out of trying to solve these two issues. Ben and I reached out to a few folks who were avid BitMEX supporters in Hong Kong and very good financial engineers. We asked them (Joseph Wang & Bhavik Patel) for ideas on how to create such a product. What came back was something that looked a lot like Robert Shiller’s perpetual futures contract he wrote about in a paper published in 1993.

Our first perp swap was a product where longs and shorts exchanged future cash flows based on a USD and XBT funding rate that updated daily. The dominant crypto spot and margin trading exchange at the time was Bitfinex, which offered a liquid peer-to-peer lending market. Users could borrow and lend through these markets, and this directly influenced the interest rates margin traders paid. This was the design of the first perp we launched in May 2016. The margin system used an insurance fund combined with a socialized loss mechanism called Dynamic Profit Equalization; we jokingly referred to internally as the Double Penetration Experience. We rolled out the XBTUSD perpetual swap, delisted the Bitcoin/USD daily and monthly futures, but left the quarterly futures contracts. Confusion abounded among most clients, and our support ticket volume soared. One of the biggest mind fucks to traders was the funding rate. They didn’t understand the calculation. Customers berated us on the forums, in our TrollBox, and via support tickets. They demanded we remove the perp and be like OKCoin which offered the most liquid quarterly futures contract. Internally, a split emerged between those for keeping the product and those for going back to only offering futures contracts.

The confusion was bad enough, but the rapidly ascending price of Bitcoin presented another problem. The success of Schiller’s design requires the home and foreign currency interest rates to be dynamic enough to influence behavior. If these rates are not responsive enough to the market, the perp will trade at a big discount or premium vs. spot called the basis. With Bitcoin in 2016, the price was rising rapidly, so it was hard to find traders to short the market. Another way of putting it, is that synthetic dollars used to purchase spot and leveraged Bitcoin on exchanges were in short supply.[6] Somehow, we needed to increase the supply of synthetic dollars on BitMEX. In Schiller’s design, the observed market USD to XBT interest rate differential does this. USD rates should be higher than XBT rates if Bitcoin is rising rapidly in dollar terms. On Bitfinex, USD yielded 1% per day and Bitcoin much less. That is a sizable difference, but when Bitcoin is pumping 10-25% a day, it isn’t high enough to entice arbitrageurs to synthetically lend dollars by selling the perp and buying Bitcoin in a market-neutral fashion. Given that an external platform provided the USD and XBT interest rates, we had no control over them at BitMEX. The result was that our swap traded at a high and rising premium to spot.

The issue with a large basis between the perp and spot is that it creates a problem for the margin system. To illustrate this, I will provide a stylized and extreme example.

XBTUSD (the perp swap) = $1,000  
XBT (spot) = $500

Basis = $500

For traders, you can mark their position at the current perp or spot price. If we mark to spot, longs have an unrealized loss of $500 and shorts an unrealized gain of $500. In order to ensure that longs can meet their margin requirements, we must add an additional $500 margin charge. If we mark to the perp, there is no additional margin charge for longs, but if the perp quickly snaps back to the spot price, then the longs are underwater by $500 and the shorts cannot profit. In order to prevent socialized loss situations, we marked traders to spot.[7] This resulted in higher margin requirements for longs. This is not ideal as it makes trading too expensive relative to our competitors that don’t require longs to post this extra margin. I recognized the problem we faced and began working on a solution, but it would be a while before market situations prompted its implementation.

For those internally who were skeptical about whether we should continue offering the perp, this market dysfunction validated their opinion. I believed this product was our future and salvation as an exchange, but I needed to come up with a solution to this problem otherwise the negative feedback would force us to revert to futures. My solution was to create a look back index that recorded the basis between the swap and spot. This basis, subject to some limits, becomes the next period’s funding rate. E.g. if the perp traded at an average 1% premium to spot over the last eight hours, if you held a position at the funding period timestamp, longs would pay 1% to shorts.

To prevent insta-liquidation at the funding timestamp (12:00 UTC, 20:00 UTC, 04:00 UTC), we auto-rebalanced unrealized and realized PNL and capped the funding rate using this function:

_Min (Funding Rate, 75% * Maintenance Margin or 0.5%)_

To dial up and down the sensitivity of the funding rate to the premium index, one just shortens and lengthens the time between funding periods, respectively. E.g. if you charged funding every hour, the maximum daily cumulative funding paid is 0.35% * 12 = 4.20% PER DAY.

Ben, Jinming, and I worked out how to implement this new funding calculation from a trading engine and markets structure perspective for a week. Ben and Jinming added the functionality to our trading engine quickly. The functionality was ready to go; it just took extreme market dysfunction to force us to roll it out.

Our fucked-up markets pissed clients off. Sam wanted to kill the swap, and I persuaded him that if we rolled out the premium index that within a few days the market would fix itself. For good and for bad, BitMEX was not an Arthur Hayes dictatorship but a triumvirate of Arthur, Ben, and Sam that ruled by consensus. I got a stay of execution for the perp and went about fixing the market in true Arthur Hayes style. Subtlety is not one of my virtues, and I decided that an abrupt change over a weekend in mid-June 2016 would be the most effective course of action.[8]

I announced that 24-hour hence, the funding mechanism would change to the look back premium index. The perp was trading at a large premium, and post the announced changes it contracted immediately, as longs closed positions in anticipation of large funding payments. The funding payments would increase substantially because of the large perp price premium versus spot. By Monday morning, the perp was trading much closer to spot, lessening the market dysfunction. I told Sam to give it another day, and the basis would be minimal because of the power of high interest rates. The perp began behaving nicely by the time Ben, Jinming, and I arrived at our Lai Chi Kok office for dim sum on Monday. Thankfully, my hunch about creating a self-corrective mechanism to alter funding amounts based on a prior period’s basis worked, and internally the calls to remove the perp evaporated.

The only major subsequent change to the product design was the introduction of Automatic Deleveraging (ADL). We copied the Huobi ADL mechanism but made a few tweaks. The biggest issues with Huobi’s implementation of ADL were that traders couldn’t estimate their probability of their position being closed early in profit, and when ADL’d traders lost their entire position. Therefore, our innovation was to create a ranking system based on a few factors and allowing for partial ADL. The front-end presented traders with a heat bar that showed them the probability of their position being ADL’d. The partial ADL feature allowed the exchange to close out less than the entire position in order to balance the profit and loss from longs and shorts.

Over the next few months, we slowly phased out all dated futures contracts on Bitcoin and then altcoins. Day by day, traders became comfortable with how perps traded and grew to like the product. One day in late 2017, BitMEX overtook OKCoin as the most liquid derivatives exchange, and by the end of 2018, BitMEX was the largest crypto exchange by volume globally across spot and derivatives.

Everyone stands on the shoulders of others. I want to list the prior art that led to the creation of perps to give credit where credit is due.

**ICBIT:**

This was the first crypto derivatives exchange. They invented the inverse futures contract. That means that the margin & PNL currency, Bitcoin, was the same as the home currency. E.g. Each contract is worth $100 of Bitcoin at any price. The contract’s dollar exposure is $100 regardless of the price of Bitcoin. In Bitcoin terms, the exposure is 1/x. This is an exotic derivative, but it works because the exchange only accepts Bitcoin deposits. This was where I first traded Bitcoin futures, and I modelled the inverse contracts at BitMEX based on their design.

**Robert Schiller:**

As I explained earlier, he wrote a paper in 1993 about a perpetual futures contract. The interest payments exchanged between longs and shorts were determined by an exogenous pricing source. I never read his paper, but I imagine his ideas influenced the advice we received from Joseph Wang and Bhavik Patel.

**Chinese Commodity Exchanges:**

The concepts of socialized loss, ADL, and the insurance fund originated here. 796 was the first Chinese domiciled crypto derivatives exchange to use a socialized loss system. 796’s tech stack and understanding of exotic derivatives couldn’t cope with offering degen’s 50x leverage. Ultimately, because of its poor implementation, the high weekly socialized loss tax rates gave OKCoin and Huobi an opening to steal all their Chinese clients.

To be fair, back then most crypto traders couldn’t price a quanto and inverse Bitcoin futures contract correctly. When BitMEX started, we offered both types of futures. Our anchor market maker, which still is one of the largest crypto prop shops, got smoked by mis-pricing these contracts even after I told them their maths was wrong. Their revenge was to rage quit the exchange for three years after they essentially blew up.

**OKCoin:**

The first iteration of BitMEX’s margin system mimicked the socialized loss system of OKCoin.

**Huobi:**

Many features of Huobi’s inspired BitMEX’s ADL margin system.

Thanks for reading this perp history lesson. But who gives a fuck? Why did this invention from a no-name exchange in Hong Kong create a movement that will change the derivatives trading patterns of most financial assets? To understand that, I will step through why ‌perps appeal to retail traders.

**The Perfect Retail Trading Product**

Perps plus a socialized loss margin system solve for the two L’s: **Leverage & Liquidity**. Therefore, retail traders love perps. And because retail traders love perps, they threaten the TradExchanges’ rent-seeking behavior.

It is very difficult for retail traders to obtain high leverage because in most jurisdictions retail traders cannot access derivatives markets offered by TradExchanges. Therefore, they gravitate to shady bucket shops offering highly leveraged contracts for difference (CFD). When trading CFDs, punters face the bucket shop directly, whereas with perps and futures, clients trade on a transparent orderbook. If the bucket shop is dodgy, it will not allow clients to get in and out of positions at reasonable prices. If traders wish to avoid non-consensual ass-fucking by CFD bucket shops, their only way to get their leverage fix is to use options. This is why products like 0DTE options are so popular in many markets. The implicit leverage is insane on these products. The problem with options is that the contracts’ return doesn’t vary one to one with the underlying asset like a futures contract does. In industry speak, futures are “delta one” products. I was a delta one trader for my brief TradFi career. Back in the early days of perps, because of their understanding of delta one derivatives, some of BitMEX’s best traders were my former colleagues on delta one desks across Hong Kong. Some folks used to devote one of their many screens on the trading floor to trading BitMEX perps during work.

To really grasp why perps are so transformative, I need to delve deeper into how margin systems work in TradFi and in crypto.

One reason TradFi exchanges cannot offer high leverage to retail is that their clearinghouses guarantee settlement. If the losing side goes bankrupt, the clearinghouse must possess enough paid-in capital to pay out the winners. As a result, the exchange uses the courts to go after all assets of any bankrupt trader. But in crypto, the situation is completely different. The volatility of crypto is very high. Couple that volatility with high leverage, and it’s a recipe for mass liquidations. For us crypto exchange owners, it isn’t feasible to recover crypto using the courts because the cryptos we must recover are bearer assets. In TradFi, you don’t own your financial assets; an intermediary does. Thus, the courts can easily instruct a bank, which as an arm of the government will always follow the court’s decision, to send your assets to the TradExchange to settle your debts. A court cannot tell the Bitcoin blockchain to send Bitcoin from one address to another. As a result, crypto exchange margin systems can only count on the initial margin posted to satisfy liquidations. Therefore, the socialized loss system combined with an insurance fund is absolutely necessary to operate a crypto derivatives exchange.

Another reason TradExchanges cannot offer 100x leverage is that their clearinghouses are woefully under-collateralized. I did some research a few years back on the capitalization levels of the largest global clearinghouses. I learned some scary shit. Given that crypto is a 24/7 market that governments and central banks cannot manipulate like equities, bonds, and FX, a large price movement up or down in Bitcoin for example coupled with a large open interest in the derivatives market could destroy the largest exchanges globally. Therefore, the margin levels on crypto and other derivatives offered by TradExchanges are much lower than their native crypto competitors. This is an important point to understand when comparing the new equity perp products launched by Hyperliquid and BitMEX (coming soon) that feature high leverage (20x) versus the low levels of leverage offered on equity futures contracts listed on TradExchanges. Retail will eschew the TradExchange equity derivatives offering for the high-leveraged equity perp offerings of crypto exchanges. The only way for TradExchanges to compete is to alter the clearing model of the entire global derivatives market, which I don’t see happening anytime soon. The history of leverage at BitMEX offers an instructive case study.

BitMEX started out with a guaranteed settlement margin system. As a result, we could only offer 3x leverage. Our insufficient leverage as compared to our Chinese competitors was the major reason that for the first nine months of operation, we traded effectively $0 volume. To compete, I switched our system to a socialized loss one, which combined with our superior trading engine tech allowed us to increase leverage to 100x by October 2015. Quickly thereafter, our trading volumes mooned and brought the exchange to profitability.

The crypto derivatives exchange provides the client with the high leverage they cannot obtain in TradFi, but the cost is that if the price moves too quickly up or down, sometimes traders don’t realize their full profit. This is perfect for crypto because if we didn’t have perps, using options to obtain leverage would be too expensive. Nick Andrianov, Maelstrom’s head trader, who used to run exotic derivatives at Deutsche Bank Hong Kong, always points out how inefficient crypto options are vs. perps regarding leveraged trading. He told me that a 30 implied vol Bitcoin/USD call option with a month to maturity would only return 3.1x on equity if the price of Bitcoin moved up 10% in a day. Let’s contrast that with trading a perp on 100x leverage. The initial margin is 1%; e.g. you put down 1 BTC of margin for a position size of 100 BTC. BTC rises 10% in one day, which means your unrealized profit is 10 BTC or a 10x return on equity.

Being right trading options on a high-vol asset is less profitable than being right trading a highly leveraged perp. Therefore, traders use perps rather than options to obtain leveraged exposure.

Let’s move on to the next L - Liquidity.

Because perps never expire, it removes the need to split liquidity across a strip of futures contracts. The invention of perps allowed us at BitMEX to merge liquidity onto one contract. This gave us the critical liquidity mass to attack the leadership of OKCoin and Huobi, who split liquidity across several quarterly futures contracts. Another benefit of only having one contract per crypto is that it is easier to understand from a UI/UX perspective for a retail trader. The user doesn’t have to figure out which contract is the best one to trade given their objectives. There is only one option, and it’s very liquid.

When you discover the Lord, you must spread the gospel. And after the perp made BitMEX into the largest exchange in the world, it was time to attack other markets.

**The Empire Strikes Back**

The understatement of my life is that perps and TradFi were not a match made in heaven.

I wholeheartedly believe that perps are a better product than futures and options contracts for the vast majority of traders and, most importantly, for the exchange itself. This belief that I was selling a superior and safer product naively provided confidence that I could convince regulators of its merits. I wanted BitMEX to own the market for crypto-enabled trading of any asset class. That is how I thought we could destroy the CME. I came to this conclusion by evaluating perps vs. TradFi futures and options on these variables:

**Collateral Usage & Safety:**

_Because perps allow for high leverage, clients don’t have to keep as much collateral on the exchange. For TradFi exchanges where banks custody fiat margin, this is not a concern. But for crypto exchanges, where hacks routinely happen, clients must be hypervigilant about where and how much collateral they leave on exchange._

_If fiat stablecoins become the means by which clients fund their TradExchanges accounts in the future, security of bearer blockchain assets even for TradFi becomes a genuine issue, and they will appreciate why crypto exchanges prefer clients minimize the amount of capital left on exchange._

**Financial Safety:**

_With a socialized loss margin system, the most a crypto trader can lose is their initial margin. No matter how terrible of a trader they are, cough cough James Wynn, losses on crypto exchanges cannot affect their off-platform finances. Contrast this with TradFi, where a James Wynn type degenerate could destroy his entire financial net worth because the exchange comes after all his financial assets to settle debts._

**Exchange Safety & Competition:**

_The exchange can offer highly leveraged trading on high volatility assets because settlement isn’t guaranteed. The users accept that sometimes profitable traders do not receive all their winnings for the ability to trade using 100x leverage. Because it is not a prerequisite to have a fuck ton of paid-up capital to support guaranteed settlement of a conventional clearinghouse, the number of exchange offerings rises. Exchanges compete to offer differentiated products. In TradFi, most domiciles have one national derivatives exchange, and the combination of government support and a large capital base used to support a guaranteed settlement clearing house, prohibit any competition._

By mid-2018 because I believed perps supported by a socialized loss margin system were the safest way to offer a large retail trading public access to highly leveraged derivatives, I figured it was time to meet the CFTC in the US to grant us a license. My goal at the time was to make BitMEX bigger than the CME, which then, as it is now, is the largest derivative exchange globally. This required entering and dominating the US derivatives market. With our lawyers, ‌ Sullivan & Cromwell, we set up a meeting in Washington, D.C. with the CFTC Labs and CFTC markets divisions. The goal of the two meetings was to ascertain whether the CFTC was interested in accepting a DCM and DCO license application to bring BitMEX’s perps and our socialized loss margin system to the US market.[9]

We spent the morning meeting with both teams. They asked very intelligent questions… I explained in-depth how BitMEX operated including the perps product and the socialized loss margin system. A few weeks later, I learned the CFTC was not interested in receiving our license application. And that was that until over two years later, the US Department of Justice and CFTC indicted us for criminal and civil violations of the Bank Secrecy Act and Commodities Exchange Act.

I was very naïve to think that the CFTC would appreciate my sound arguments. The CFTC, like all regulators, is in the business of protecting the status quo. No amount of logic is going to persuade them to allow competition if they believe the current market structure is adequate. Allowing true innovation into finance is something regulators globally are reluctant to do because it could cause the fall of their national financial champions. To his credit; and he doesn’t deserve much, Sam Bankman-Fried (SBF) capitalized on the mistake we made at BitMEX. He and his politically connected mommy and daddy attempted to accomplish the same thing, bringing perps to the US and going head-to-head with the CME, by doing it the American way… donating a fuck ton of money to politicians (mostly the Democratic Party).

When you ask folks why they invested in FTX, or believed SBF would be successful, they bring up the fact that SBF’s parents were Stanford professors with close ties to the Democratic Party. I don’t know about now, but they were some of the largest campaign finance bundlers for the party. When we talk about American campaign finance, the terms used connote a certain amount of legitimacy. We talk about “donations” and “bundling”; but when the West talks about other countries and their campaign finance regimes, it’s all about “bribery” and “corruption”. What Western investors duped by SBF were saying in polite terms was that SBF was legally bribing the right people.

Some of my detractors might counter that I’m just a sourpuss who lost and am throwing shade at a man who can’t reply so quickly because of his current incarceration. But one remembers that by mid-2022, FTX was on the cusp of obtaining a banking license to offer its own stablecoin, and a DCM and DCO license from the CFTC. Observe the photo library below, and you come away with the impression that SBF is a trusted pal of the establishment even as his business is attempting to destroy one of their largest corporate donors, the banking system. The right kind of white boy walks into the lion’s den and gets a hug; this nigger walks in and catches a charge. It is what it is; read my essay “**[White Boy](https://www.bitmex.com/blog/white-boy)** ” for a more in-depth discussion on how SBF used stereotypes to his advantage and to the detriment of his clients, investors, and global regulators. SBF and FTX.us handed out close to $100m in campaign donations, and if he hadn’t been a no-talent ass clown regarding risk management and trading, FTX would be bigger than Binance at this current moment.

[![](https://substackcdn.com/image/fetch/$s_!lnez!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff18b87de-5cdf-48db-a661-fd12ef794730_625x276.png)](https://substackcdn.com/image/fetch/$s_!lnez!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff18b87de-5cdf-48db-a661-fd12ef794730_625x276.png)

[![](https://substackcdn.com/image/fetch/$s_!deEd!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F04b66072-cf1d-40a5-af82-74e753d9dd06_623x297.png)](https://substackcdn.com/image/fetch/$s_!deEd!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F04b66072-cf1d-40a5-af82-74e753d9dd06_623x297.png)

Awe that’s cute. US House of Representatives Maxine Waters, to the right of SBF, was the Chairperson of the powerful House Committee of Financial Services from 2020 to 2022, the glory days of FTX. See, it’s not racial. This is the post-racial American future Dr. Martin Luther King envisioned when he gave his I Have a Dream speech in 1963.

[![](https://substackcdn.com/image/fetch/$s_!-UWv!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F144fd006-aa57-4b23-8fe8-1240d359af17_624x721.png)](https://substackcdn.com/image/fetch/$s_!-UWv!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F144fd006-aa57-4b23-8fe8-1240d359af17_624x721.png)

Former US President Biden appointed Caroline Pham as a CFTC commissioner in early 2022. SBF sure knows how to schmooze with the right folks. The closest I ever got to a CFTC commissioner was at a CME-sponsored piss-up in Boca Raton, Florida, in 2018.

[![](https://substackcdn.com/image/fetch/$s_!LPYp!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe9581ab9-7e3e-47da-ab4d-51b3477a6324_624x624.png)](https://substackcdn.com/image/fetch/$s_!LPYp!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe9581ab9-7e3e-47da-ab4d-51b3477a6324_624x624.png)

Money talks …

The acceptance of perps by regulators and TradFi in the US and abroad suffered a serious body blow after FTX/Alameda imploded. That is because the US Team Blue Democrats switched from ambivalent to outright hostile regarding crypto. Leading politicians trusted SBF because he was the right kind of white boy, who went to a prestigious university, and his parents were political heavyweights. To remove the stench of their complicity in SBF’s caper, they set out to prove that all along they had opposed scammy crypto. Therefore, the various US regulatory agencies went hard at US crypto folks from late 2022 to early 2025 when US President Trump retook the throne. Trump and his family’s change of heart from crypto detractors to cheerleaders bears some examination.

Trump’s pro-crypto stance is both smart politics and revenge. It’s smart politics because the Democrats alienated a rich, vocal, and growing constituency. The transformative nature of crypto allowed SBF and others to accumulate billions of dollars of wealth within only a few years. The American crypto nouveau riche eagerly supported any politician who deemed them worthy of their support. Trump and his ‌Team Red Republicans raised hundreds of millions from wealthy crypto individual donors, companies, and PACs.[10] And in 2024 this money helped Trump win a landslide victory over Democrat presidential candidate Kamala Harris and for the Republicans to take the House of Representatives and the Senate. This was one of the most resounding victories in modern American political history.

The reason I went through this history of perps’ regulation in the US is twofold. First, most global TradFi regulators follow the US like lemmings. It’s a cover your ass situation. No regulator can lose their job because they followed the Empire’s financial regulations. But if a regulator acts differently, and suffers an adverse outcome, they will certainly get shown the door. Therefore, if the US is embracing perps for whatever reason, it gives regulators permission to embrace them too. SGX, for example, launched perps as soon as Trump made crypto acceptable again for TradFi regulators. Second, I want to offer this history as proof that the state of play won’t change at a minimum until 2029 when Trump’s reign concludes. By then, the largest S&P 500 and or Nasdaq 100 derivative will be an equity perp traded on a crypto exchange rather than a contract traded on the CME. By this point, perps will be too large in influence to destroy if the next Pax Americana emperor is anti-crypto.

Before I move on to how perps will completely upend stonk trading, I want to offer this perspective on their power based on the wealth creation of a few perps’ main characters. Chengpeng Zhao (CZ) co-founder of Binance, is, I believe, one of the top ten richest humans in the world who is not a political leader. He achieved this in under a decade. And I trace the rise of his wealth directly to when Binance took over from BitMEX as the largest exchange in the world in March 2020 off the back of the Bitcoin COVID price collapse. Binance took perps to another level in terms of adoption, which, coupled with their dominance in the altcoin trading space, created a crypto exchange juggernaut. SBF created FTX after trading perps for his hedge fund Alameda on BitMEX. SBF achieved dollar billionaire status the fastest ever in human history, at least on paper, through the growth of FTX, which essentially only offered perps. Jeff Yan from Hyperliquid is probably a dollar billionaire if not very close to it after creating the fastest-growing perp DEX and ultimately might become the largest exchange ever in human history if my **[stablecoin thesis](https://cryptohayes.substack.com/p/buffalo-bill)** plays out. The next crop of crypto billionaires in the exchange space will come from the intersection of perps and stonks.

**Equity Perps**

TradFi is clinging for dear life to its dominance of equities trading. The public stock markets are politically and financially very important to the establishment. It will be very interesting to observe how they react to equity perps quickly gaining traction. The first market perps will dominate is the offshore trading of US stock price risk.

US stocks, and all stocks for that matter, will eventually be tokenized. But equity perps don’t need equity tokenization to succeed. Perps on stocks already have the substrate to proliferate. The US stock market is the largest globally. The largest US tech stocks, like Nvidia, have market caps larger than most countries’ annual GDP. Globally, everyone uses their products. But most retail traders cannot trade these stocks. These retail traders are used to trading crypto 24/7 anywhere in the world with high leverage. If you gave a Jaewon in Seoul, the ability to punt NVDA perps on the subway home from his dead-end job at a Chaebol, in the same way he can trade Bitcoin, he would be all for it. This is the promise of equity perps.

Equity perps already trade over $100m per day. It will soon be billions of dollars per day as traders and market makers get comfortable with the contract specs. With the increased occurrence of surprise political, military, and economic announcements on Friday nights after TradFi markets close, equity perps will be the way both institutional and retail traders hedge risk over weekends. This will force the large US stock exchanges to move to 24/7 trading faster than they otherwise would have. Will crypto muppets or suited and booted banksters win the equity perp market? This will depend on whether TradFi regulators allow clearinghouses to offer a socialized loss system.

I predict that by the end of 2026, price discovery for the largest US tech stocks and the key US indices (i.e. S&P 500, Nasdaq 100) will happen on perps markets serving retail. I will smile when financial media show the ticker of an S&P 500 equity perp as the best pricing source rather than the CME’s Globex version. It’s not too late; the CME and other exchanges have all the advantages in the world and a plethora of smart, motivated employees. Maybe they will read this essay and get their shit together. There is no excuse to allow a bunch of crypto degens to disintermediate them, especially when the regulators compete on who gets to fluff the exchange.

**The Final Frontier**

The most traded derivatives contract globally is the CME SOFR futures contract. Fixed-income trading volumes dwarf those of the equity, FX, and crypto markets. The challenge that I put out to our crypto community is to create a derivative that allows retail to speculate on interest rates in a new way. The team at Pendle is hard at work doing this. Their Boros protocol is quickly gaining traction. But this vertical is wide open for many innovators to offer their ideas to the market.

**Want More?** Follow the Author on **[Instagram](https://www.instagram.com/cryptohayes/)** , **[LinkedIn](https://www.linkedin.com/in/arthur-hayes-b493b42/)** and **[X](https://x.com/cryptohayes)**

Access the Korean language version here: **[Naver](https://blog.naver.com/maelstromkorea)**

Subscribe to see the latest Events: **[Calendar](https://lu.ma/mevents)**

* * *

[1] SGX stands for Singapore Stock Exchange; CBOE stands for Chicago Board Options Exchange.

[2] The CFTC is the Commodities and Futures Trade Commission and is the regulatory body responsible for derivatives regulation in America. The CME stands for the Chicago Mercantile Exchange.

[3] ADV stands for average daily trading volume.

[4] The futures contracts expired in March, June, September, and December i.e. every quarter.

[5] I will use XBT and BTC both as currency symbols to refer to the cryptocurrency Bitcoin.

[6] Shorts provide synthetic dollars to the crypto market by purchasing Bitcoin and selling a Bitcoin/USD derivative to create a price neutral position. They earn the basis between the derivative and spot; this is essentially what Ethena does today. Please read my [Crypto Trader Digest](https://www.bitmex.com/blog/crypto-trader-digest-may-16) from May 2016 where I introduced the concept.

[7] Our marking system is a bit more complicated than that, but for the purpose of discussion just assume we marked to spot.

[8] Before we moved to the premium index determined funding rate, we also shortened the funding period from 24 hours to 8 hours in early June.

[9] A DCM is a Designated Contract Market, you can think of this as the exchange where users trade. A DCO is a Designated Clearing Organization, you can think of this as the clearinghouse.

[10] A PAC is a political action committee.