import styles from "./auth-transition.module.css";

export function AuthTransition({ stage }: { stage: "signin" | "signout" | "workspace" }) {
  const copy = {
    signin: ["Starting your showroom", "Checking your route and loading the right workspace."],
    signout: ["Parking securely", "Closing your session and returning to sign in."],
    workspace: ["Loading your workspace", "Bringing your lead desk online."],
  }[stage];

  return <main className={styles.transition} aria-live="polite"><section><div className={styles.route} aria-hidden="true"><div className={styles.scooter}><i /><b /><em /></div></div><p>REVERA LEAD CONTROL</p><h1>{copy[0]}<span>.</span></h1><small>{copy[1]}</small></section></main>;
}
