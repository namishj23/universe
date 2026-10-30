"""Plain-language explanation of each signal, naming common harmless causes. Never a verdict."""

TEXT = {
    "head_turn": ("The person's head turned away from their usual direction for {d} s{turns}. "
                  "Common harmless causes: stretching, looking at the clock or the invigilator, "
                  "or resting the head on a hand."),
    "phone_visible": ("The model saw an object it recognised as a mobile phone near this person for {d} s. "
                      "Common harmless causes: a calculator, a wallet, a pencil case, or a hand on the face."),
    "restricted_zone": ("The person's feet were inside the restricted area marked for this clip for {d} s. "
                        "Common harmless causes: walking to the invigilator, collecting paper, or a zone drawn "
                        "close to a seat."),
    "unusual_posture": ("Unusual posture (supporting detail): the optional posture model rated the posture as "
                        "unusual for {d} s. Common harmless causes: stretching, leaning to pick something up, "
                        "or a hand on the face."),
}


def explain(flag):
    turns = flag.evidence.get("turns") if isinstance(flag.evidence, dict) else None
    text = TEXT[flag.signal].format(
        d=round(flag.end_seconds - flag.start_seconds, 1), turns=f" ({turns} turns)" if turns and turns > 1 else "")
    return text + " This is an observed event for human review; the system decides nothing."
