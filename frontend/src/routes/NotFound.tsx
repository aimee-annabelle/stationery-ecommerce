import { Link } from "react-router-dom";
import { strings } from "../strings";

export function NotFound() {
  return (
    <>
      <h1>{strings.notFound.title}</h1>
      <p>{strings.notFound.body}</p>
      <Link to="/">{strings.notFound.home}</Link>
    </>
  );
}
