import { ApiType } from "../services/types";

interface Props {
  value: ApiType.ConnectionsItem;
}

const ConnectionItem = (props: Props) => {
  const { value } = props;

  return <div>{value.metadata.host || value.metadata.destinationIP}</div>;
};

export default ConnectionItem;
