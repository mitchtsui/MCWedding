# Caption evaluation inputs

Run `node scripts/evaluate.mjs private/review.json`. Inputs are private human annotations;
the program outputs aggregate metrics only. This example is synthetic:

```json
{
  "mode": "mock",
  "measurementMethod": "direct-recording",
  "clockErrorMs": 40,
  "segments": [{
    "id": "example-1",
    "phraseEndMs": 5000,
    "reviews": {
      "en": {"verdict":"correct","firstCorrectMs":8000,"finalMs":10000,"criticalError":false,"revisions":0},
      "ja": {"verdict":"unreviewed","firstCorrectMs":null,"finalMs":null,"criticalError":false,"revisions":0},
      "zh-CN": {"verdict":"missing","firstCorrectMs":null,"finalMs":null,"criticalError":false,"revisions":0}
    }
  }]
}
```

Use `mode: "live"` only for an actual live pipeline measurement. Methods are `same-clock`,
`calibrated-cross-device`, or `direct-recording`; retain clock calibration/error evidence
privately. Times share the recording's validated origin, not unrelated device clocks.
`firstCorrectMs` is the human-identified first understandable correct rendering on the
guest screen, not the API's first token. `finalMs` is the final guest rendering.

All phrases require three explicit language reviews. Keep failures and unreviewed items.
Do not classify agreement with an imperfect script as correctness. Gate thresholds and
the required 100-phrase sample are explained in [LIVE_CAPTIONS.md](LIVE_CAPTIONS.md).
Passing this language gate does not pass permissions, network, capacity or venue gates.
