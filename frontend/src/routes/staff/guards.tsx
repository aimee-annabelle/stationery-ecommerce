import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { type Capability, useStaffSession } from "../../lib/staffSession";
import { strings } from "../../strings";

/** The "Owner access only" screen from the S5-S8 designs. The API also answers 403. */
export function AccessDenied() {
  const t = strings.staff.denied;
  return (
    <div className="denied">
      <span className="denied-icon">
        <icons.lock size={30} />
      </span>
      <h2>{t.title}</h2>
      <p>{t.body}</p>
      <Link className="btn btn-primary" to="/staff">
        {t.back}
      </Link>
    </div>
  );
}

export function RequireCapability({ capability, children }: { capability: Capability; children: React.ReactNode }) {
  const { can } = useStaffSession();
  return can(capability) ? <>{children}</> : <AccessDenied />;
}

/** A staff page from a later build stage. */
export function ComingSoon({ title, stage }: { title: string; stage: number }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{strings.staff.comingSoon(stage)}</p>
        </div>
      </div>
    </>
  );
}
