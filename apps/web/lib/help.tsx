import type { Me } from "@hashinet/types";
import type { ReactNode } from "react";

/**
 * Help (prototype help.js): guides and questions for the reader's role, each naming who it is
 * for. Each slice adds its own with its screens, so Help never explains a page that isn't there.
 */
export type HelpRole =
  | "owner"
  | "business-manager"
  | "venue-manager"
  | "operator"
  | "platform-staff"
  | "platform-operator";

export interface Guide {
  id: string;
  area: string;
  for: HelpRole[];
  title: string;
  gist: string;
  steps: ReactNode[];
  wrong: [string, ReactNode][];
}

export interface Question {
  for: HelpRole[];
  area: string;
  q: string;
  a: string;
}

export function helpRole(me: Me): HelpRole | null {
  if (me.active.scope === "platform") {
    return me.active.role === "operator" ? "platform-operator" : "platform-staff";
  }
  return BUSINESS_ROLE[me.active.role];
}

const BUSINESS_ROLE: Record<Me["active"]["role"], HelpRole | null> = {
  owner: "owner",
  business_manager: "business-manager",
  venue_manager: "venue-manager",
  venue_operator: "operator",
  admin: null,
  manager: null,
  operator: null,
};

export const AREAS: Record<"business" | "platform", string[]> = {
  business: [
    "Getting started",
    "Selling",
    "Guests and devices",
    "Your venues",
    "Your team",
    "Your account",
  ],
  platform: ["Issues", "Businesses", "Routers", "Your team", "Your account"],
};

const PLATFORM: HelpRole[] = ["platform-staff", "platform-operator"];
/** Everyone at a business. */
const BUSINESS: HelpRole[] = ["owner", "business-manager", "venue-manager", "operator"];
/** Those who run a team: owners and managers. */
const MANAGERS: HelpRole[] = ["owner", "business-manager", "venue-manager"];
/** Those who act for the whole business, such as blocking a device. */
const WHOLE: HelpRole[] = ["owner", "business-manager"];

const PROTECT_OPERATOR: Guide = {
  id: "protect",
  area: "Your account",
  for: ["operator"],
  title: "Protect your sign-in",
  gist: "An authenticator app or a passkey, if you like.",
  steps: [
    <>
      Your email code is enough, but you can add more. Open <b>Account and security</b>.
    </>,
    "Set up an authenticator: scan the code with its app and enter the 6 digits it shows.",
    "Save your recovery codes somewhere safe. Each one signs you in once without the app.",
    "Or add a passkey: your phone or laptop's fingerprint, face or PIN signs you in.",
  ],
  wrong: [],
};

const COUNTER: Guide[] = [
  {
    id: "sell",
    area: "Selling",
    for: BUSINESS,
    title: "Sell a voucher",
    gist: "Choose the package, confirm, hand over the code.",
    steps: [
      <>
        Tap <b>Sell</b> at the bottom of the screen. On a computer, use <b>Sell a voucher</b> on
        Overview or Vouchers.
      </>,
      "Tap the package the guest asked for. Its price is on it; there is nothing to type.",
      "Check the sale and choose cash or mobile money. For mobile money, read out where to pay, shown on screen, and enter the guest's mobile money number.",
      <>
        Tap <b>Confirm sale</b> once the money is in your hand, or has reached the venue.
      </>,
      <>
        Hand it over: the guest joins the WiFi named on screen and scans the QR code, or you tap{" "}
        <b>Send</b> or <b>Print</b>.
      </>,
      <>
        Tap <b>Sell another</b> for the next guest.
      </>,
    ],
    wrong: [
      [
        "You sold the wrong package",
        "Sell the right one. An owner or manager refunds the wrong voucher from Vouchers while it is unused, and records how the money went back.",
      ],
      [
        "You chose the wrong package before confirming",
        <>
          Tap <b>Change package</b> and choose again.
        </>,
      ],
      [
        "The guest can't get online",
        "Check they joined the WiFi named on screen, then scan again. The voucher's time starts only when they get online.",
      ],
    ],
  },
  {
    id: "cash",
    area: "Selling",
    for: ["operator"],
    title: "Hand over the day's cash",
    gist: "Match the cash in the drawer to what HashiNet recorded.",
    steps: [
      <>
        Open <b>Today</b>. <b>Cash today</b> is the cash you took for the vouchers you sold, less
        any cash you gave back.
      </>,
      "Count the cash. It should match.",
      "Hand it over with that figure. Mobile money sales are not in it; they're paid to the business directly.",
    ],
    wrong: [
      [
        "The cash doesn't match",
        "Check Your sales today for a sale made by mistake, and tell your manager before the day ends.",
      ],
    ],
  },
  {
    id: "session",
    area: "Guests and devices",
    for: BUSINESS,
    title: "End a session or release a voucher",
    gist: "Take a device off, or free a voucher's place for another.",
    steps: [
      <>
        Open <b>Live sessions</b> and find the device, or search by its voucher's code.
      </>,
      <>
        Tap <b>End session</b>. The device goes offline; the voucher keeps the time it has left.
      </>,
      <>
        To let the guest use another phone instead, open <b>Vouchers</b>, find the code and tap{" "}
        <b>Release</b>.
      </>,
    ],
    wrong: [],
  },
  {
    id: "block",
    area: "Guests and devices",
    for: WHOLE,
    title: "Block a device",
    gist: "Keep a device off your WiFi.",
    steps: [
      <>
        Open <b>Devices</b> and find it by its name or MAC address.
      </>,
      <>
        Tick it and tap <b>Block</b>. Its session ends and it can't sign in again at your venues. To
        block several, tick them all.
      </>,
      <>
        To let it back, choose <b>Blocked</b>, then tap <b>Unblock</b> on its row.
      </>,
    ],
    wrong: [
      [
        "A blocked guest is back",
        "Many phones change their MAC address now and then. Block the new one too.",
      ],
    ],
  },
  ...(
    [
      ["owner", "Choose business manager, venue manager or venue operator."],
      ["business-manager", "Choose venue manager or venue operator."],
      ["venue-manager", "They join as a venue operator, working the counter."],
    ] as const
  ).map(
    ([role, choice]): Guide => ({
      id: "invite",
      area: "Your team",
      for: [role],
      title: "Invite someone to your team",
      gist: "Give a colleague their own sign-in.",
      steps: [
        <>
          Open <b>Team</b> under Business and tap <b>Invite someone</b>.
        </>,
        "Enter their email address.",
        choice,
        "For a venue role, tick the venues they work at.",
        "Send it. They sign in with a code sent to their email; until then it waits on Team.",
      ],
      wrong: [
        [
          "They didn't get the email",
          "Check the address on Team and send the invitation again from there.",
        ],
        ["Someone has left", "Open Team and remove them. They're signed out at once."],
      ],
    }),
  ),
];

export const GUIDES: Guide[] = [
  {
    id: "start",
    area: "Getting started",
    for: ["owner"],
    title: "Get your venue online",
    gist: "Four steps from joining to guests on your WiFi.",
    steps: [
      <>
        On your <b>Overview</b>, choose how your MikroTik router comes: <b>Connect</b> your own,{" "}
        <b>Install</b> one we bring, or <b>Launch</b> with a new internet line too. Or ask to talk
        first.
      </>,
      "HashiNet's team calls you within a working day, goes over the venue, and agrees the package and what it costs, line by line, all on one bill.",
      "Once it is paid, we agree a day and the team sets the router up at your venue.",
      "Protect your sign-in before then: your venue serves guests only once you have.",
    ],
    wrong: [
      [
        "Nobody called",
        "Contact HashiNet's support from Help. Your choice is already with the team.",
      ],
    ],
  },
  {
    id: "issue",
    area: "Issues",
    for: PLATFORM,
    title: "Work an issue",
    gist: "Claim it, do its steps, hand it on or let it go.",
    steps: [
      <>
        Open <b>Issues</b>. Each row is something that needs someone; open it to see what to do.
      </>,
      <>
        Tap <b>Claim</b> so others see you are on it. Adding a note or doing a step claims it too.
      </>,
      <>
        Done with your part? <b>Hand to</b> a colleague, with a note, or <b>Release</b> it for
        anyone.
      </>,
      <>
        Someone below you is stuck or away? <b>Take over</b>, with a reason they see.
      </>,
      "A router issue closes itself once the router serves again; a setup closes when the venue's first guest gets online.",
    ],
    wrong: [
      [
        "An issue is marked Stalled",
        "Its holder has done nothing on it for a day. Ask them, or take it over if you are above them.",
      ],
    ],
  },
  {
    id: "onboard",
    area: "Businesses",
    for: ["platform-staff"],
    title: "Onboard a venue",
    gist: "Call the owner, agree the package, get it paid, schedule the setup.",
    steps: [
      <>
        Open the venue&apos;s <b>Confirm … package</b> issue. It shows what the owner prefers and
        how to reach them.
      </>,
      "Call them: the venue's size, guests at peak, where the line comes in and where the router can go.",
      <>
        Choose the package and enter what it costs line by line: the <b>onboarding fee</b> for this
        business, the MikroTik router, and a line or ISP router for Launch. Then{" "}
        <b>Confirm package</b>.
      </>,
      <>
        When the money comes, <b>Record payment</b>, in full. The admin and managers record it
        whoever holds the issue.
      </>,
      <>
        <b>Schedule setup</b> with the day agreed and who goes. The setup becomes its own issue,
        handed to them.
      </>,
    ],
    wrong: [
      [
        "The package needs to change",
        "Change the package works until it is paid or its setup is scheduled.",
      ],
    ],
  },
  {
    id: "setup",
    area: "Routers",
    for: PLATFORM,
    title: "Set up a venue handed to you",
    gist: "Add the router, run its script, set it up, check a phone.",
    steps: [
      <>
        Open the <b>Set up … router</b> issue in Issues. It shows the router to bring and the setup
        day.
      </>,
      <>
        <b>Open router</b> and add it: its name is the WiFi name guests see.
      </>,
      "Run its setup script on it, at the office or at the venue; the step ticks itself when it reaches HashiNet.",
      "At the venue, the ISP router goes into port 1. Run Set up from the router page.",
      "Join the WiFi on a phone and get online with a voucher. The issue closes with the first guest.",
    ],
    wrong: [
      [
        "Add router is refused",
        "The venue's setup has to be handed to you first. Ask the admin or a manager.",
      ],
      [
        "Set up finishes but no guest can get online",
        "The business's owner has not protected their sign-in yet; the venue serves once they do.",
      ],
    ],
  },
  {
    id: "team",
    area: "Your team",
    for: ["platform-staff"],
    title: "Bring someone onto the team",
    gist: "Managers run onboarding; operators install routers.",
    steps: [
      <>
        Open <b>Team</b> under Platform and tap <b>Invite someone</b>.
      </>,
      "Enter their email and choose the role. You can give only roles below your own.",
      "They give their name, sign in with a code, and protect their sign-in before they start.",
    ],
    wrong: [
      [
        "Someone is leaving",
        "Remove them from Team: they lose access at once, and what they did stays in the audit log.",
      ],
    ],
  },
  {
    id: "guest",
    area: "Guests and devices",
    for: BUSINESS,
    title: "Help a guest get online",
    gist: "From joining the WiFi to browsing.",
    steps: [
      "The guest joins the venue's WiFi. On most phones the sign-in page opens by itself.",
      "If it doesn't, they open any website and are sent to it, or they scan the voucher's QR code.",
      <>
        They scan the code or type its 12 digits, and tap <b>Connect</b>.
      </>,
    ],
    wrong: [
      [
        "The guest has a new phone",
        "Release the voucher from Vouchers; they sign in on the new phone with the same code.",
      ],
      ["“This voucher has ended”", "Its time is used up and can't be extended. Sell a new one."],
      [
        "Connected, but no internet",
        "Check the router on Overview. If it's offline, follow “When a router is offline”; guests keep their time.",
      ],
    ],
  },
  {
    id: "offline",
    area: "Guests and devices",
    for: BUSINESS,
    title: "When a router is offline",
    gist: "What to check, and what guests keep.",
    steps: [
      <>
        <b>Overview</b> shows it at the top, and the router's figure says Offline.
      </>,
      "Check the MikroTik router has power and its lights are on.",
      "Check the internet line works: try another device on it, or restart your internet provider's router.",
      "Unplug the MikroTik router for ten seconds and plug it back in.",
      "Guests online keep their time. The notice goes once the router is serving again.",
    ],
    wrong: [
      [
        "Still offline after fifteen minutes",
        "Contact HashiNet's support; HashiNet sees the router's last report and calls if needed.",
      ],
    ],
  },
  {
    id: "prices",
    area: "Your venues",
    for: ["owner"],
    title: "Change a package or its price",
    gist: "What guests can buy, and for how much.",
    steps: [
      <>
        Open <b>Packages</b> under Settings.
      </>,
      <>
        Tap <b>Change price</b>, or add or remove a package.
      </>,
      "Guests see a new price straight away. Vouchers already sold keep their price, and a removed package's vouchers keep working.",
    ],
    wrong: [],
  },
  {
    id: "p-invite",
    area: "Businesses",
    for: ["platform-staff"],
    title: "Invite a business",
    gist: "Start a new customer on HashiNet.",
    steps: [
      <>
        Open <b>Businesses</b> and tap <b>Invite a business</b>.
      </>,
      "Enter the owner's email. The link in the email works once, for 72 hours.",
      "They give their details, the business and its first venue, then sign in with a code.",
    ],
    wrong: [
      [
        "The link has expired or was lost",
        "Tap Resend beside the invitation: a new link goes out and the old one stops working.",
      ],
    ],
  },
  {
    id: "router",
    area: "Routers",
    for: PLATFORM,
    title: "Run a router's setup script",
    gist: "WinBox, an ethernet cable and the script from the router's page.",
    steps: [
      <>
        <b>Get WinBox</b> from{" "}
        <a
          className="link"
          href="https://mikrotik.com/download"
          target="_blank"
          rel="noopener noreferrer"
        >
          mikrotik.com/download
        </a>
        , under WinBox.
      </>,
      <>
        <b>Plug in.</b> Port 1 of the MikroTik router into the venue's network; the laptop into port
        2 with an ethernet cable.
      </>,
      <>
        <b>Sign in.</b> In WinBox's Neighbors tab, click the router by its MAC address (on the
        sticker under it), as admin with no password.
      </>,
      <>
        <b>Reset it with no default configuration.</b> In New Terminal, run{" "}
        <code>/system reset-configuration no-defaults=yes skip-backup=yes</code>; the router
        restarts blank.
      </>,
      <>
        <b>Sign in again</b> the same way.
      </>,
      <>
        <b>Run the script.</b> In New Terminal, paste the script from the router's page and press
        Enter. Or drag the downloaded file into Files and run <code>/import</code> with its name.
      </>,
      <>
        <b>Wait a minute.</b> The router calls HashiNet through its tunnel and the step ticks
        itself.
      </>,
    ],
    wrong: [
      [
        "The router is not under Neighbors",
        "Check the cable is in port 2, and that the laptop's firewall lets WinBox through.",
      ],
      [
        "Pasting stops with an error on a long line",
        "Use Download and import the file instead; it has no line limit.",
      ],
      [
        "The step doesn't tick after a few minutes",
        "The router has no internet on port 1. Try another network, or check the internet router allows it.",
      ],
    ],
  },
  {
    id: "protect",
    area: "Your account",
    for: [...MANAGERS, ...PLATFORM],
    title: "Protect your sign-in",
    gist: "An authenticator app or a passkey.",
    steps: [
      <>
        Owners and managers must, within 7 days of joining; HashiNet's team must before they start.
        Open <b>Account and security</b>.
      </>,
      "Set up an authenticator: scan the code with its app and enter the 6 digits it shows.",
      "Save your recovery codes somewhere safe. Each one signs you in once without the app.",
      "Or add a passkey: your phone or laptop's fingerprint, face or PIN signs you in.",
    ],
    wrong: [],
  },
  ...COUNTER,
  PROTECT_OPERATOR,
];

export const QUESTIONS: Question[] = [
  {
    for: BUSINESS,
    area: "Guests and devices",
    q: "Does a guest lose time when the router goes offline?",
    a: "No. Devices online keep their time once it reconnects.",
  },
  {
    for: BUSINESS,
    area: "Guests and devices",
    q: "Can one voucher work on two phones?",
    a: "If its package allows two devices, yes. To move it to another phone, release it from Vouchers.",
  },
  {
    for: BUSINESS,
    area: "Selling",
    q: "Do we print vouchers before we sell them?",
    a: "No. A voucher is made when it is sold, so none can be taken or go unsold. Print one if the guest wants paper.",
  },
  {
    for: ["venue-manager", "operator"],
    area: "Guests and devices",
    q: "A device is misusing the WiFi. Can I block it?",
    a: "Blocking is for the owner and business managers. Tell them which device it is; they block it from Devices.",
  },
  {
    for: MANAGERS,
    area: "Your team",
    q: "Who can see what I change?",
    a: "Every change is in the Audit log, with who made it and when.",
  },
  {
    for: ["operator"],
    area: "Your account",
    q: "Do I need an authenticator app?",
    a: "No. Your email code is enough. You can add one in Account and security if you like.",
  },
  {
    for: [...MANAGERS, ...PLATFORM],
    area: "Your account",
    q: "I lost the phone with my authenticator",
    a: "Sign in with one of your recovery codes, then set it up again in Account and security. No codes left? Contact HashiNet's support: they confirm it's you, then reset it.",
  },
  {
    for: PLATFORM,
    area: "Businesses",
    q: "Can we see a business's guests or devices?",
    a: "Only as counts. Device lists and sessions belong to the business.",
  },
  {
    for: ["platform-operator"],
    area: "Issues",
    q: "Why don't I see every issue?",
    a: "Operators see the issues handed to them: a setup handed to you is your go-ahead to install its router.",
  },
  {
    for: ["owner"],
    area: "Getting started",
    q: "Why does my package cost what it does?",
    a: "It is the onboarding fee agreed for your business and each thing your plan brings, line by line, on your Overview. HashiNet deals with the partners, so you pay one bill.",
  },
];

/** What the reader's role sees: its guides, and its questions. */
export function helpFor(me: Me): { guides: Guide[]; questions: Question[]; areas: string[] } {
  const role = helpRole(me);
  if (role === null) return { guides: [], questions: [], areas: [] };
  const guides = GUIDES.filter((g) => g.for.includes(role));
  const areas = AREAS[me.active.scope].filter((a) => guides.some((g) => g.area === a));
  return { guides, questions: QUESTIONS.filter((q) => q.for.includes(role)), areas };
}
