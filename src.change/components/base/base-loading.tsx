import { styled } from "@mui/material";

const Loading = styled("div")`
  position: relative;
  display: flex;
  height: 100%;
  min-height: 18px;
  box-sizing: border-box;
  align-items: center;

  & > div {
    box-sizing: border-box;
    width: 6px;
    height: 6px;
    margin: 2px;
    border-radius: 100%;
    animation: loading 0.7s -0.15s infinite linear;
  }

  & > div:nth-child(2n-1) {
    animation-delay: -0.5s;
  }

  @keyframes loading {
    50% {
      opacity: 0.2;
      transform: scale(0.75);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

const LoadingItem = styled("div")(({ theme }) => ({
  background: theme.palette.text.secondary,
}));

export const BaseLoading = () => {
  return (
    <Loading>
      <LoadingItem />
      <LoadingItem />
      <LoadingItem />
    </Loading>
  );
};
