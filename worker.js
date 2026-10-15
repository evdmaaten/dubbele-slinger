import { simulate, compareConvergence } from './physics.js';
self.onmessage = ({data}) => {
  try {
    const primary = simulate(data.params);
    const twin = simulate({...data.params, theta2: data.params.theta2 + data.params.perturbation});
    const {coarse, fine, ...convergence} = compareConvergence(data.params);
    self.postMessage({id:data.id,primary,twin,convergence});
  } catch(error) {self.postMessage({id:data.id,error:error.message});}
};
