import { Link } from "react-router-dom";
import { strings } from "../strings";

export function NotFound() {
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-24 text-center sm:px-6">
      <h1 className="m-0 font-heading text-[44px] font-medium">{strings.notFound.title}</h1>
      <p className="mt-3 text-muted">{strings.notFound.body}</p>
      <Link to="/" className="font-semibold underline">
        {strings.notFound.home}
      </Link>
    </section>
  );
}
